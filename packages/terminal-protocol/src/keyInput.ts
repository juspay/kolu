/**
 * Key-input encoding policy — how a named key (`Esc`, `Up`, `Enter`) or a Ctrl
 * chord maps to the raw bytes a PTY expects.
 *
 * Plain strings (latin1-safe, all ASCII): byte-level consumers convert at their
 * boundary, exactly as `bracketedPaste.ts` does with the paste markers.
 *
 * Arrows use the NORMAL-cursor (`\x1b[A`) form, not application-cursor
 * (`\x1bOA`): a blind producer can't know the program's DECCKM state, and
 * normal-cursor is the repo's default (see `snapshotReset.ts`).
 */

/** Named/control keys → the raw bytes a terminal expects. Keys are lowercase:
 *  {@link encodeKey} folds the caller's spelling down before looking one up.
 *  Consumers reading a FIXED key (`NAMED_KEY_BYTES.esc`, the mobile key bar)
 *  get a guaranteed `string`. */
export const NAMED_KEY_BYTES = {
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

const NAMED_KEY_LOOKUP = new Map<string, string>(
  Object.entries(NAMED_KEY_BYTES),
);

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

/** Fold a char under Meta/Alt — `b` → `\x1bb`. Meta is encoded as an ESC prefix
 *  (the classic 8th-bit-set alternative). */
export function metaByte(char: string): string {
  return `\x1b${char}`;
}

/** The named keys {@link encodeKey} accepts, as one human string for help text
 *  and unknown-key errors. Slashes group the arrow cluster. */
export const ACCEPTED_KEY_NAMES =
  "Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space, Shift-Tab";

/** A named key (`Escape`, `Up`, `Enter`, case-insensitive) or a modifier chord
 *  (`C-c`, `M-b`) → its raw bytes; `undefined` when unrecognized. `M-<char>`
 *  (meta/alt) prefixes ESC to the char verbatim (`M-b` → `\x1bb`). */
export function encodeKey(name: string): string | undefined {
  const named = NAMED_KEY_LOOKUP.get(name.toLowerCase());
  if (named !== undefined) return named;
  const ctrl = /^c-(.)$/i.exec(name)?.[1];
  if (ctrl !== undefined) return controlByte(ctrl);
  const meta = /^m-(.)$/i.exec(name)?.[1];
  if (meta !== undefined) return metaByte(meta);
  return undefined;
}
