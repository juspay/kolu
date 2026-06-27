/**
 * Pure logic for the `send` subcommand — turn the text/keys a caller passes into
 * the exact byte writes that reach the PTY, with no I/O or transport so it is
 * unit-testable without a socket. `main.ts` is the thin glue that resolves the
 * id, reads stdin, issues `terminal.write` for each planned chunk, and prints.
 *
 * `send` writes EXACTLY what the caller asked for — the literal text, plus any
 * explicit `--key`s — and nothing more. It does NOT append a submit Enter on its
 * own: a prompt is sent only when you say so, with `kaval-tui send <id> --key
 * Enter`. Keeping submit explicit avoids two traps an implicit Enter fell into:
 * it's invisible magic the caller can't time, and against Claude Code's
 * bracketed-paste / debounced input it raced the paste and was silently dropped —
 * so `send` would report success while the prompt sat staged, unsubmitted. Make
 * submitting its own `send --key Enter` (a separate write, after the text has
 * settled) and the race is gone too.
 *
 * The one transformation `send` does apply is BRACKETED PASTE for multiline or
 * piped-stdin text: the agent's input box takes it as ONE block instead of
 * submitting line-by-line (each `\n` would otherwise fire a half-written prompt).
 * It is auto — on for multiline / stdin, off for a single-line argument — and
 * `--paste` / `--no-paste` force it; the `paste` field of the result makes it
 * visible, never silent.
 */
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  controlByte,
  metaByte,
  NAMED_KEY_BYTES,
} from "@kolu/terminal-protocol";

/** The named keys `send` accepts, as one human string for the command help, the
 *  `--key` flag help, and the unknown-key error — so the vocabulary is written
 *  ONCE, not hand-copied across three doc strings (the drift class `keyInput.ts`
 *  was created to kill). Slashes group the arrow cluster; `send.test.ts` guards
 *  that every token here resolves via `encodeKey` and that every byte in
 *  `NAMED_KEY_BYTES` is reachable from it, so adding a key to the table without
 *  listing it here fails CI — the same protection pulam's `WAIT_STATES` enjoys. */
export const ACCEPTED_KEY_NAMES =
  "Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space, Shift-Tab";

/** A named key (`Escape`, `Up`, `Enter`, case-insensitive) or a modifier chord
 *  (`C-c`, `M-b`) → its raw bytes; `undefined` when unrecognized. The named-key
 *  table and the `C-` control fold come from `@kolu/terminal-protocol`, so this
 *  CLI shares the one byte vocabulary with the rich client and the mobile key
 *  bar; only the CLI-only `C-`/`M-` chord parsing lives here. `M-<char>`
 *  (meta/alt) prefixes ESC to the char verbatim (`M-b` → `\x1bb`). */
export function encodeKey(name: string): string | undefined {
  const named = NAMED_KEY_BYTES[name.toLowerCase()];
  if (named !== undefined) return named;
  // Bind the captured char directly so it narrows to `string` (the regex has one
  // group, but `noUncheckedIndexedAccess` types `match[1]` as `string | undefined`).
  const ctrl = /^c-(.)$/i.exec(name)?.[1];
  if (ctrl !== undefined) return controlByte(ctrl);
  const meta = /^m-(.)$/i.exec(name)?.[1];
  if (meta !== undefined) return metaByte(meta);
  return undefined;
}

/** The ordered byte writes a `send` issues, plus what it actually did (for the
 *  human/JSON line). `paste` is the EFFECTIVE value — text-gated and
 *  paste-auto-resolved — not the raw flag. */
export interface SendPlan {
  /** Each element is one `terminal.write` payload, issued in order. */
  writes: string[];
  /** Total UTF-8 bytes across every write (paste markers + keys included). */
  bytes: number;
  paste: boolean;
}

/** Plan the writes for a send. Pure: the text, the paste flag, whether the text
 *  came from stdin, and the already-encoded `keyData` are passed in. Paste is
 *  resolved here (auto unless `paste` is set); the text goes first, then the keys
 *  verbatim. No submit Enter is ever synthesized — the caller sends one as an
 *  explicit `--key Enter`, which lands in `keyData`. */
export function planSend(opts: {
  text: string;
  paste: boolean | undefined;
  fromStdin: boolean;
  keyData: string;
}): SendPlan {
  const hasText = opts.text.length > 0;
  // Auto-paste: a single-line argument types literally, but multiline OR piped
  // stdin is bracketed so it lands as one block. An explicit flag overrides.
  const paste =
    hasText && (opts.paste ?? (opts.fromStdin || opts.text.includes("\n")));

  const writes: string[] = [];
  if (hasText) {
    writes.push(
      paste
        ? `${BRACKETED_PASTE_START}${opts.text}${BRACKETED_PASTE_END}`
        : opts.text,
    );
  }
  // Keys are their own write, after the text — so a `--key Enter` submit lands
  // after the (possibly pasted) text rather than riding inside its write.
  if (opts.keyData.length > 0) writes.push(opts.keyData);

  const bytes = writes.reduce((n, s) => n + Buffer.byteLength(s, "utf8"), 0);
  return { writes, bytes, paste };
}
