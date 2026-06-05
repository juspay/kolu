/** Rail-chip label derivation — the two-glyph identity painted on a
 *  32 px tile in the collapsed dock. The repo half is the first
 *  alphanumeric character of the repo name in any script (`répo` → `R`,
 *  `日本語` → `日`), uppercased; the sub half is the first grapheme of the
 *  intent (an emoji or other symbol when the user leads with one), with a
 *  fallback to the first alphanumeric character of the branch tail when the
 *  intent is unset. Each half is clamped to a single grapheme so unicode
 *  case-expansion (`ß` → `SS`) can't paint two glyphs on a one-glyph tile.
 *
 *  Cards mode renders the same intent through `IntentMarkdownInline`,
 *  which preserves emoji and symbol prefixes verbatim. The chip's sub
 *  glyph reads through `intentLeadGlyph` so the rail can't disagree
 *  with the cards header on the same source string — both surfaces
 *  share `packages/client/src/intent/text.ts`. */

import type { TerminalMetadata } from "kolu-common/surface";
import { intentLeadGlyph } from "../../intent/text";
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

const graphemes =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Case `glyph` (upper or lower) but keep the chip's one-glyph invariant:
 *  unicode case conversion can *expand* a single letter — `ß`.toUpperCase()
 *  is `"SS"`, `İ`.toLowerCase() is `i` + U+0307 — which would paint two
 *  glyphs on a tile sized for one. We re-clamp to the first grapheme cluster
 *  after casing so the rail chip stays exactly one visual glyph. */
function caseToOneGlyph(glyph: string, mode: "upper" | "lower"): string {
  const cased = mode === "upper" ? glyph.toUpperCase() : glyph.toLowerCase();
  if (graphemes) {
    const first = graphemes.segment(cased)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...cased][0] ?? cased;
}

/** Two-glyph rail-chip label.
 *
 *  - `repo` — first alphanumeric char of `info.key.group` in any script,
 *    uppercased (`"kolu"` → `"K"`, `"répo"` → `"R"`). Repo names don't carry
 *    emoji, so the alphanumeric-only match is intentional here.
 *  - `sub` — first grapheme of the intent's display line (line 1, with
 *    leading markdown chrome stripped) when the intent is set;
 *    lowercased when it's an ASCII letter, passed through verbatim when
 *    it's an emoji or other symbol. Falls back to the first alpha-num
 *    of the branch tail when the intent has nothing renderable.
 *  - `subIsGlyph` — `true` when `sub` is a non-ASCII-alphanumeric
 *    grapheme. The CSS hook (`data-glyph`) uses this to drop the faded
 *    opacity that would mute an emoji. */
export function chipInitials(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo,
): { repo: string; sub: string; subIsGlyph: boolean } {
  const repoChar = info.key.group.match(ALPHANUM)?.[0] ?? "?";
  const repo = caseToOneGlyph(repoChar, "upper");
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
