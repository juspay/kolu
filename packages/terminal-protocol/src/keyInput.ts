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
 *
 * Names arrive from humans (`kolu send --key <name>`, the MCP face's `key`
 * argument), so the lookup is own-property-only — see {@link isNamedKey}. An
 * unrecognized name must always come back `undefined` and become a loud error;
 * an inherited `Object.prototype` member resolving as if it were a key would
 * type its own source code into a live terminal.
 */

/** Named/control keys → the raw bytes a terminal expects. Keys are lowercase:
 *  {@link encodeKey} folds the caller's spelling down before looking one up. */
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

/** The table, for consumers reading a FIXED key (`NAMED_KEY_BYTES.esc`, the
 *  mobile key bar) — those get a guaranteed `string`. Deliberately NOT widened
 *  with a `Record<string, string | undefined>` index signature: that signature
 *  claimed *any* string indexes this table, which is false, and it is how a
 *  name inherited from `Object.prototype` (`constructor`, `toString`,
 *  `valueOf`, `hasOwnProperty`) used to sail through {@link encodeKey} — a live
 *  terminal was sent ~35 bytes of JavaScript source instead of an error. An
 *  arbitrary, user-supplied name has exactly one door now: {@link encodeKey},
 *  which gates the read behind {@link isNamedKey}. */
export const NAMED_KEY_BYTES: typeof NAMED_KEYS = NAMED_KEYS;

/** Own-property guard for {@link NAMED_KEYS} — the prototype-safety boundary.
 *  `Object.hasOwn` (not `in`, not a bare lookup) so nothing inherited from
 *  `Object.prototype` can pose as a key; the predicate return type is what lets
 *  the read stay cast-free. */
function isNamedKey(name: string): name is keyof typeof NAMED_KEYS {
  return Object.hasOwn(NAMED_KEYS, name);
}

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
 *  (the classic 8th-bit-set alternative), the third sibling key-encoding rule
 *  beside the named-key table and {@link controlByte}, so every producer of
 *  key-press bytes shares this one home. */
export function metaByte(char: string): string {
  return `\x1b${char}`;
}

/** The named keys {@link encodeKey} accepts, as one human string for help text
 *  and unknown-key errors — so the vocabulary is written ONCE, not hand-copied
 *  across doc strings (the drift class this module was created to kill).
 *  Slashes group the arrow cluster; `keyInput.test.ts` guards that every token
 *  here resolves via {@link encodeKey} and that every byte in
 *  {@link NAMED_KEY_BYTES} is reachable from it, so adding a key to the table
 *  without listing it here fails CI. */
export const ACCEPTED_KEY_NAMES =
  "Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space, Shift-Tab";

/** A named key (`Escape`, `Up`, `Enter`, case-insensitive) or a modifier chord
 *  (`C-c`, `M-b`) → its raw bytes; `undefined` when unrecognized. Graduated
 *  here from kaval-tui's `send` the day the kolu MCP face became its second
 *  verbatim consumer (`lifecycle_sendInput`'s `key` argument speaks the same
 *  vocabulary), so the named-key grammar has ONE home beside the byte tables
 *  it folds through. `M-<char>` (meta/alt) prefixes ESC to the char verbatim
 *  (`M-b` → `\x1bb`). This is the ONLY door for a name that came from a human
 *  (`kolu send --key`, `lifecycle_sendInput`), so the own-property guard below
 *  is the whole prototype-safety story; `undefined` here becomes a loud, named
 *  error listing {@link ACCEPTED_KEY_NAMES} at the call site — never a write. */
export function encodeKey(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (isNamedKey(lower)) return NAMED_KEYS[lower];
  // Bind the captured char directly so it narrows to `string` (the regex has one
  // group, but `noUncheckedIndexedAccess` types `match[1]` as `string | undefined`).
  const ctrl = /^c-(.)$/i.exec(name)?.[1];
  if (ctrl !== undefined) return controlByte(ctrl);
  const meta = /^m-(.)$/i.exec(name)?.[1];
  if (meta !== undefined) return metaByte(meta);
  return undefined;
}
