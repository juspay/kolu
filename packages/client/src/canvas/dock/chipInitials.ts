/** Repo monogram + rail-chip label derivation.
 *
 *  Two independent facts, deliberately not one function:
 *
 *  - `repoMonogram(group)` — one glyph for a repo name. Cards-mode section
 *    headers and the rail chip's *repo* half both call this, so a monogram
 *    and a rail chip never disagree on the same group string.
 *  - `chipInitials(meta, info)` — two-glyph rail tile: monogram + branch/
 *    intent sub. Needs live meta (intent lead); the monogram does not.
 *
 *  Hickey: monogram identity is not braided into the intent/branch fold.
 *  Löwy: monogram revs only when the repo set changes; chip sub revs with
 *  intent — keep the clocks separate. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import { firstGrapheme, intentLeadGlyph } from "../../intent/text";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";

// Unicode-aware alphanumeric: any letter or number in any script. A repo
// named `répo`/`日本語` or a unicode-led branch tail should still yield a
// meaningful initial instead of the `?` fallback an ASCII-only `[a-z0-9]`
// would force. `\p{L}`/`\p{N}` need the `u` flag.
const ALPHANUM = /[\p{L}\p{N}]/u;
// Anchored to a single grapheme: a letter optionally followed by combining
// marks (`\p{M}`), so a *decomposed* (NFD) accented letter — `e` + U+0301 —
// still reads as a letter and not a glyph. We normalize to NFC before this
// test anyway, but `\p{M}` keeps marks that have no composed form from
// falling through to the glyph branch.
const ALPHANUM_ANCHORED = /^[\p{L}\p{N}]\p{M}*$/u;

/** Case `glyph` (upper or lower) but keep the one-glyph invariant:
 *  unicode case conversion can *expand* a single letter — `ß`.toUpperCase()
 *  is `"SS"`, `İ`.toLowerCase() is `i` + U+0307 — which would paint two
 *  glyphs on a tile sized for one. We re-clamp to the first grapheme cluster
 *  after casing so every monogram / chip half stays exactly one visual glyph. */
function caseToOneGlyph(glyph: string, mode: "upper" | "lower"): string {
  const cased = mode === "upper" ? glyph.toUpperCase() : glyph.toLowerCase();
  return firstGrapheme(cased) || cased;
}

/** One-glyph monogram for a repo `group` (git repo name or cwd basename).
 *
 *  Prefers the first alphanumeric in any script, uppercased (`"kolu"` →
 *  `"K"`, `"répo"` → `"R"`, `".dotfiles"` → `"D"`). When there is none —
 *  home `~`, pure punctuation — falls through to the first grapheme as-is
 *  so the tile still carries identity rather than a generic `?`. Empty
 *  string is the only path to `?`. */
export function repoMonogram(group: string): string {
  const alnum = group.match(ALPHANUM)?.[0];
  if (alnum) return caseToOneGlyph(alnum, "upper");
  const lead = firstGrapheme(group.normalize("NFC"));
  return lead || "?";
}

/** Two-glyph rail-chip label.
 *
 *  - `repo` — `repoMonogram(info.key.group)` (shared with cards headers).
 *  - `sub` — first grapheme of the intent's display line (line 1, with
 *    leading markdown chrome stripped) when the intent is set;
 *    lowercased when it's a unicode letter or digit (`\p{L}`/`\p{N}`),
 *    passed through verbatim when it's an emoji or other symbol. Falls
 *    back to the first alpha-num of the branch tail when the intent has
 *    nothing renderable.
 *  - `subIsGlyph` — `true` when `sub` is a non-alphanumeric grapheme
 *    (emoji, symbol, punctuation). The CSS hook (`data-glyph`) uses
 *    this to drop the faded opacity that would mute an emoji. */
export function chipInitials(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo,
): { repo: string; sub: string; subIsGlyph: boolean } {
  const repo = repoMonogram(info.key.group);
  const branchTail = info.key.label.split("/").pop() ?? "";
  // Compose to NFC so a decomposed accented lead (`e` + U+0301) classifies as
  // one letter rather than falling through to the glyph branch.
  const intentGlyph = meta.intent
    ? intentLeadGlyph(meta.intent).normalize("NFC")
    : "";
  if (intentGlyph) {
    // A unicode *letter* lead (`é`, `Ω`) reads as a faded letter, not a glyph;
    // only true symbols/emoji (not `\p{L}`/`\p{N}`) keep the glyph treatment.
    return ALPHANUM_ANCHORED.test(intentGlyph)
      ? { repo, sub: caseToOneGlyph(intentGlyph, "lower"), subIsGlyph: false }
      : { repo, sub: intentGlyph, subIsGlyph: true };
  }
  const subChar = branchTail.match(ALPHANUM)?.[0] ?? "?";
  const sub = caseToOneGlyph(subChar, "lower");
  return { repo, sub, subIsGlyph: false };
}
