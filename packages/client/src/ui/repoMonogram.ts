/** One-glyph monogram for a short identity string (repo group, host label).
 *
 *  Lives in `ui/` — not under the dock — so every surface that paints a
 *  monogram (dock, palette, restore, inspector, title bar) shares ONE fold.
 *  The rail chip's repo half reuses this via `chipInitials`; never re-derive
 *  the first letter elsewhere.
 *
 *  Hickey: monogram identity is not braided into intent/branch.
 *  Löwy: monogram revs when the identity string set changes — a pure
 *  string→glyph function with no render clock. */

import { firstGrapheme } from "../intent/text";

/** Unicode-aware alphanumeric: any letter or number in any script.
 *  Shared with `chipInitials` sub-glyph path so case-expand rules stay one fold. */
export const ALPHANUM = /[\p{L}\p{N}]/u;

/** Case `glyph` but keep the one-glyph invariant: unicode case conversion
 *  can *expand* a single letter (`ß` → `"SS"`). Re-clamp after casing.
 *  Shared monogram + rail chip sub half. */
export function caseToOneGlyph(glyph: string, mode: "upper" | "lower"): string {
  const cased = mode === "upper" ? glyph.toUpperCase() : glyph.toLowerCase();
  return firstGrapheme(cased) || cased;
}

/** One-glyph monogram for an identity string.
 *
 *  Prefers the first alphanumeric in any script, uppercased (`"kolu"` →
 *  `"K"`, `"répo"` → `"R"`, `".dotfiles"` → `"D"`). When there is none —
 *  home `~`, pure punctuation — falls through to the first grapheme as-is.
 *  Empty string is the only path to `?`. */
export function repoMonogram(group: string): string {
  const alnum = group.match(ALPHANUM)?.[0];
  if (alnum) return caseToOneGlyph(alnum, "upper");
  const lead = firstGrapheme(group.normalize("NFC"));
  return lead || "?";
}
