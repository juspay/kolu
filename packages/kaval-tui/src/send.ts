/**
 * Pure logic for the `send` subcommand — turn the text/keys a caller passes into
 * the exact byte writes that reach the PTY, with no I/O or transport so it is
 * unit-testable without a socket. `main.ts` is the thin glue that resolves the
 * id, reads stdin, issues `terminal.write` for each planned chunk, and prints.
 *
 * `send` is the *write* half of driving a program in a terminal — typically a
 * prompt to a Claude Code / Codex / opencode agent. Two details make it correct
 * for those agents rather than just for one-liners:
 *   - Multiline text is wrapped in a BRACKETED PASTE so the agent's input box
 *     takes it as ONE block instead of submitting line-by-line (each `\n` would
 *     otherwise fire a half-written prompt). Paste is auto: on for multiline or
 *     piped-stdin text, off for a single-line argument; `--paste`/`--no-paste`
 *     force it.
 *   - The submit Enter after a paste is a SEPARATE write from the paste block.
 *     Claude Code races a carriage return that rides inside the same write as the
 *     paste terminator, so the `\r` is emitted on its own, after `\x1b[201~`.
 */
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "@kolu/terminal-protocol";
import { shortId } from "./render.ts";

/** The carriage return that submits a line — what pressing Enter sends a PTY. */
const CR = "\r";

/** Named/control keys → the raw bytes a terminal expects, or `undefined` for an
 *  unrecognized name (the caller fails loud). Arrows use the NORMAL-cursor
 *  (`\x1b[A`) form, not application-cursor (`\x1bOA`): a blind one-shot `send`
 *  can't know the program's DECCKM state, and normal-cursor is the repo's
 *  default and only producer (see `snapshotReset.ts` / `MobileKeyBar`). Control
 *  chords fold via the same `& 0x1f` rule as the rich client's `stickyModifiers`.
 */
const NAMED_KEYS: Record<string, string> = {
  enter: CR,
  return: CR,
  tab: "\t",
  escape: "\x1b",
  esc: "\x1b",
  space: " ",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
};

/** Fold a single char into its control byte — `c` → 0x03, `a` → 0x01, `[` → ESC.
 *  Control bytes exist for `@ A–Z [ \ ] ^ _` (0x40–0x5f) → 0x00–0x1f; `Space`
 *  (and `@`) → NUL. Anything else (e.g. `C-1`) has no control byte → undefined. */
function encodeCtrl(char: string): string | undefined {
  if (char === " ") return "\x00";
  const code = char.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  return undefined;
}

/** A named key (`Escape`, `Up`, `Enter`, case-insensitive) or a modifier chord
 *  (`C-c`, `M-b`) → its raw bytes; `undefined` when unrecognized. `M-<char>`
 *  (meta/alt) prefixes ESC to the char verbatim (`M-b` → `\x1bb`). */
export function encodeKey(name: string): string | undefined {
  const named = NAMED_KEYS[name.toLowerCase()];
  if (named !== undefined) return named;
  // Bind the captured char directly so it narrows to `string` (the regex has one
  // group, but `noUncheckedIndexedAccess` types `match[1]` as `string | undefined`).
  const ctrl = /^c-(.)$/i.exec(name)?.[1];
  if (ctrl !== undefined) return encodeCtrl(ctrl);
  const meta = /^m-(.)$/i.exec(name)?.[1];
  if (meta !== undefined) return `\x1b${meta}`;
  return undefined;
}

/** The ordered byte writes a `send` issues, plus what it actually did (for the
 *  human/JSON line). `enter`/`paste` are the EFFECTIVE values — text-gated and
 *  paste-auto-resolved — not the raw flags. */
export interface SendPlan {
  /** Each element is one `terminal.write` payload, issued in order. */
  writes: string[];
  /** Total UTF-8 bytes across every write (markers + keys included). */
  bytes: number;
  enter: boolean;
  paste: boolean;
}

/** Plan the writes for a send. Pure: the text, the flags, whether the text came
 *  from stdin, and the already-encoded `keyData` are passed in. Paste is
 *  resolved here (auto unless `paste` is set); the submit Enter is split into its
 *  own write after a paste block; named keys are appended last, in order. */
export function planSend(opts: {
  text: string;
  enter: boolean;
  paste: boolean | undefined;
  fromStdin: boolean;
  keyData: string;
}): SendPlan {
  const hasText = opts.text.length > 0;
  // Auto-paste: a single-line argument types literally, but multiline OR piped
  // stdin is bracketed so it lands as one block. An explicit flag overrides.
  const paste =
    hasText && (opts.paste ?? (opts.fromStdin || opts.text.includes("\n")));
  const enter = hasText && opts.enter;

  const writes: string[] = [];
  if (hasText) {
    if (paste) {
      writes.push(`${BRACKETED_PASTE_START}${opts.text}${BRACKETED_PASTE_END}`);
      // The submit Enter is its OWN write, after the paste terminator — a `\r`
      // riding inside the paste write races Claude Code's paste handling.
      if (enter) writes.push(CR);
    } else {
      writes.push(enter ? `${opts.text}${CR}` : opts.text);
    }
  }
  if (opts.keyData.length > 0) writes.push(opts.keyData);

  const bytes = writes.reduce((n, s) => n + Buffer.byteLength(s, "utf8"), 0);
  return { writes, bytes, enter, paste };
}

/** The human one-liner (stderr trailer) — `sent 14 bytes to a1b2c3d4 · pasted ·
 *  ⏎`. The `· pasted` / `· ⏎` marks appear only when those happened. */
export function formatSend(result: {
  id: string;
  bytes: number;
  enter: boolean;
  paste: boolean;
}): string {
  const base = `sent ${result.bytes} byte${result.bytes === 1 ? "" : "s"} to ${shortId(result.id)}`;
  const marks = `${result.paste ? " · pasted" : ""}${result.enter ? " · ⏎" : ""}`;
  return `${base}${marks}`;
}
