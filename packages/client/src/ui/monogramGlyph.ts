import { firstGrapheme } from "../intent/text";

/** Unicode-aware alphanumeric: any letter or number in any script. */
export const ALPHANUM = /[\p{L}\p{N}]/u;

/** Case `glyph` but keep the one-glyph invariant: unicode case conversion can
 *  expand a single letter (`ß` → `"SS"`), so re-clamp after casing. */
export function caseToOneGlyph(glyph: string, mode: "upper" | "lower"): string {
  const cased = mode === "upper" ? glyph.toUpperCase() : glyph.toLowerCase();
  return firstGrapheme(cased) || cased;
}

/** One-glyph monogram for an identity string: the first alphanumeric in any
 *  script, uppercased (`"kolu"` → `"K"`, `".dotfiles"` → `"D"`), else the
 *  first grapheme as-is; `?` only for the empty string. NFC-normalizes first
 *  so NFC/NFD-equivalent names yield the same glyph. */
export function repoMonogram(group: string): string {
  const nfc = group.normalize("NFC");
  const alnum = nfc.match(ALPHANUM)?.[0];
  if (alnum) return caseToOneGlyph(alnum, "upper");
  const lead = firstGrapheme(nfc);
  return lead || "?";
}
