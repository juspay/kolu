/**
 * Key-input encoding policy — how a named key (`Esc`, `Up`, `Enter`) or a Ctrl
 * chord maps to the raw bytes a PTY expects. The one home shared by every
 * producer of those bytes: the rich client's sticky-modifier fold
 * (`stickyModifiers.ts`), the mobile key bar (`MobileKeyBar.tsx`), and
 * kaval-tui's `send` CLI (`send.ts`). Before this module each kept its own copy
 * "in lockstep by comment", and they had already drifted (one had Shift+Tab the
 * others lacked); now a wrong byte or a new key is fixed once, here.
 *
 * Plain strings (latin1-safe, all ASCII): byte-level consumers convert at their
 * boundary, exactly as `bracketedPaste.ts` does with the paste markers.
 *
 * Arrows use the NORMAL-cursor (`\x1b[A`) form, not application-cursor
 * (`\x1bOA`): a blind producer can't know the program's DECCKM state, and
 * normal-cursor is the repo's default (see `snapshotReset.ts`).
 */

/** Named/control keys → the raw bytes a terminal expects. Typed so a consumer
 *  reading a FIXED key (`NAMED_KEY_BYTES.esc`, the mobile key bar) gets a
 *  guaranteed `string`, while an arbitrary lookup from user input
 *  (`NAMED_KEY_BYTES[typed]`, the `send` CLI) stays `string | undefined` and is
 *  forced to handle the miss. */
const NAMED_KEYS = {
  enter: "\r",
  return: "\r",
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
  "shift-tab": "\x1b[Z",
};

export const NAMED_KEY_BYTES: typeof NAMED_KEYS &
  Record<string, string | undefined> = NAMED_KEYS;

/** Fold a single char into its control byte — `c` → 0x03, `a` → 0x01, `[` → ESC.
 *  Control bytes exist for `@ A–Z [ \ ] ^ _` (0x40–0x5f) → 0x00–0x1f; `Space`
 *  (and `@`) → NUL. Upper-cased first so a lowercase letter folds to the same
 *  byte as its shifted form (Ctrl+r === Ctrl+R === 0x12). Anything else (a digit,
 *  say) has no control byte → `undefined`. */
export function controlByte(char: string): string | undefined {
  if (char === " ") return "\x00";
  const code = char.toUpperCase().charCodeAt(0);
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  return undefined;
}
