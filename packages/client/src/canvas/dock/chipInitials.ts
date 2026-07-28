/** Rail-chip label derivation — two-glyph tile for the collapsed dock.
 *
 *  The **repo** half is `repoMonogram` from `ui/repoMonogram` — the same fold
 *  cards headers, palette rows, restore groups, and the inspector use. The
 *  **sub** half needs live meta (intent lead) and stays here.
 *
 *  Hickey: monogram identity is not braided into the intent/branch fold.
 *  Löwy: monogram revs with the identity string set; chip sub revs with
 *  intent — keep the clocks separate. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { firstGrapheme, intentLeadGlyph } from "../../intent/text";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { repoMonogram } from "../../ui/repoMonogram";

// Re-export so existing dock imports keep working; new call sites should
// prefer `ui/repoMonogram` (or `<RepoMonogram />`).
export { repoMonogram };

// Unicode-aware alphanumeric for the *branch* sub glyph.
const ALPHANUM = /[\p{L}\p{N}]/u;
// Anchored to a single grapheme: a letter optionally followed by combining
// marks (`\p{M}`), so a *decomposed* (NFD) accented letter — `e` + U+0301 —
// still reads as a letter and not a glyph.
const ALPHANUM_ANCHORED = /^[\p{L}\p{N}]\p{M}*$/u;

/** Case `glyph` but keep the one-glyph invariant for the sub half. */
function caseToOneGlyph(glyph: string, mode: "upper" | "lower"): string {
  const cased = mode === "upper" ? glyph.toUpperCase() : glyph.toLowerCase();
  return firstGrapheme(cased) || cased;
}

/** Two-glyph rail-chip label.
 *
 *  - `repo` — `repoMonogram(info.key.group)` (shared with every monogram surface).
 *  - `sub` — intent lead grapheme when set; else first alpha-num of branch tail.
 *  - `subIsGlyph` — `true` when `sub` is non-alphanumeric (emoji/symbol). */
export function chipInitials(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo,
): { repo: string; sub: string; subIsGlyph: boolean } {
  const repo = repoMonogram(info.key.group);
  const branchTail = info.key.label.split("/").pop() ?? "";
  const intentGlyph = meta.intent
    ? intentLeadGlyph(meta.intent).normalize("NFC")
    : "";
  if (intentGlyph) {
    return ALPHANUM_ANCHORED.test(intentGlyph)
      ? { repo, sub: caseToOneGlyph(intentGlyph, "lower"), subIsGlyph: false }
      : { repo, sub: intentGlyph, subIsGlyph: true };
  }
  const subChar = branchTail.match(ALPHANUM)?.[0] ?? "?";
  const sub = caseToOneGlyph(subChar, "lower");
  return { repo, sub, subIsGlyph: false };
}
