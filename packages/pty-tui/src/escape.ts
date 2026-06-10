/**
 * The ssh-style line-start escape for `kolu-tui attach` — the ONLY thing the
 * raw passthrough ever intercepts. Every other byte (every Ctrl chord, every
 * mid-line `~`) reaches the inner program unmodified; see the "Detach /
 * escape" decision in `docs/atlas/src/content/atlas/pty-daemon-tui.mdx`.
 *
 * Semantics (the ssh model):
 *   - The escape char is recognised only *immediately after* a newline (CR or
 *     LF), and at session start — exactly when ssh would recognise it.
 *   - `<esc>.` detach · `<esc><esc>` one literal escape char · `<esc>?` help.
 *   - `<esc>` followed by anything else forwards BOTH bytes (nothing is eaten).
 *   - Inside a bracketed paste (CSI 200~ … CSI 201~ on stdin — the local
 *     terminal wraps pastes once the snapshot re-enables ?2004h) recognition
 *     is suspended entirely, so a pasted "\n~." cannot detach.
 *
 * The machine runs on BYTES, not strings: a multibyte character split across
 * stdin chunks must round-trip unmangled, so decoding to UTF-8 happens
 * downstream (attach.ts's StringDecoder), never here. State (pending escape,
 * line-start, partial paste marker) survives chunk boundaries.
 */

import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "@kolu/terminal-protocol";

export type EscapeEvent =
  /** Bytes to forward to the PTY, in order relative to the other events. */
  | { kind: "forward"; data: Buffer }
  /** `<esc>.` — detach: the caller tears down; the PTY lives on. */
  | { kind: "detach" }
  /** `<esc>?` — print the escape help to the *local* tty (nothing forwards). */
  | { kind: "help" };

export interface EscapeScanner {
  /** Scan one stdin chunk; returns the ordered events it produced. */
  feed(chunk: Buffer): EscapeEvent[];
}

const CR = 0x0d;
const LF = 0x0a;
const PASTE_START = Buffer.from(BRACKETED_PASTE_START, "latin1");
const PASTE_END = Buffer.from(BRACKETED_PASTE_END, "latin1");

/** `--escape` accepts one printable ASCII char (multi-byte or control chars
 *  would break the byte-level machine / steal chords the inner program owns). */
export function isValidEscapeChar(s: string): boolean {
  return /^[\x20-\x7e]$/.test(s);
}

/** One step of the incremental marker matcher: the next match position after
 *  seeing byte `b` at position `pos` of `marker`. A failed match can still be
 *  the START of a fresh marker (e.g. the ESC after "\x1b\x1b["), so byte 0 is
 *  re-checked rather than skipped. */
const advanceMarker = (pos: number, marker: Buffer, b: number): number => {
  if (b === marker[pos]) return pos + 1;
  return b === marker[0] ? 1 : 0;
};

/** `escapeChar` MUST already be a single printable ASCII char — validate it at
 *  the CLI boundary with `isValidEscapeChar` (main.ts does). The byte machine
 *  assumes `escByte = escapeChar.charCodeAt(0)` is one byte. */
export function createEscapeScanner(escapeChar = "~"): EscapeScanner {
  const escByte = escapeChar.charCodeAt(0);

  // Session start counts as line-start (ssh behaviour): `kolu-tui attach`
  // then immediately `~.` works without first pressing Enter.
  let atLineStart = true;
  // Saw the escape char at line start; holding it until the command byte
  // (which may arrive in the next chunk) decides its fate.
  let pendingEscape = false;
  let inPaste = false;
  // Incremental match positions for the paste markers — a marker split
  // across stdin chunks must still flip the paste state.
  let startPos = 0;
  let endPos = 0;

  return {
    feed(chunk: Buffer): EscapeEvent[] {
      const events: EscapeEvent[] = [];
      const out: number[] = [];
      const flush = (): void => {
        if (out.length > 0) {
          events.push({ kind: "forward", data: Buffer.from(out) });
          out.length = 0;
        }
      };
      // Forward one byte: track line-start and the paste-start marker. The
      // marker bytes themselves forward too — the inner program asked for
      // bracketed paste, so it expects them.
      const forward = (b: number): void => {
        out.push(b);
        atLineStart = b === CR || b === LF;
        startPos = advanceMarker(startPos, PASTE_START, b);
        if (startPos === PASTE_START.length) {
          inPaste = true;
          startPos = 0;
        }
      };

      for (const b of chunk) {
        if (inPaste) {
          out.push(b);
          endPos = advanceMarker(endPos, PASTE_END, b);
          if (endPos === PASTE_END.length) {
            inPaste = false;
            endPos = 0;
            // Whatever the paste contained, its tail on the wire is the end
            // marker — not a newline — so the next char is mid-line.
            atLineStart = false;
          }
          continue;
        }
        if (pendingEscape) {
          pendingEscape = false;
          if (b === escByte) {
            forward(escByte); // <esc><esc> → one literal escape char
          } else if (b === 0x2e /* "." */) {
            flush();
            events.push({ kind: "detach" });
          } else if (b === 0x3f /* "?" */) {
            flush();
            events.push({ kind: "help" });
            // Nothing was forwarded, so the PTY's line state is unchanged —
            // another escape works immediately (matches ssh's ~?).
            atLineStart = true;
          } else {
            forward(escByte); // not a command: the held escape char…
            forward(b); // …and the byte both forward, nothing is eaten
          }
          continue;
        }
        if (atLineStart && b === escByte) {
          pendingEscape = true;
          continue;
        }
        forward(b);
      }
      flush();
      return events;
    },
  };
}
