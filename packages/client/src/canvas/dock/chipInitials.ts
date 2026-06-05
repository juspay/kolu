/** Rail-chip label derivation — the two-glyph identity painted on a
 *  32 px tile in the collapsed dock. The repo half is always an ASCII
 *  letter; the sub half is the first grapheme of the intent (an emoji
 *  or other symbol when the user leads with one), with a fallback to
 *  the first alphanumeric character of the branch tail when the intent
 *  is unset.
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
const ALPHANUM_ANCHORED = /^[\p{L}\p{N}]$/u;

/** Two-glyph rail-chip label.
 *
 *  - `repo` — first alphanumeric char of `info.key.group`, uppercased
 *    (`"kolu"` → `"K"`). Repo names don't carry emoji, so the regex is
 *    intentional here.
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
  const repo = (info.key.group.match(ALPHANUM)?.[0] ?? "?").toUpperCase();
  const branchTail = info.key.label.split("/").pop() ?? "";
  const intentGlyph = meta.intent ? intentLeadGlyph(meta.intent) : "";
  if (intentGlyph) {
    // A unicode *letter* lead (`é`, `Ω`) reads as a faded letter, not a glyph;
    // only true symbols/emoji (not `\p{L}`/`\p{N}`) keep the glyph treatment.
    return ALPHANUM_ANCHORED.test(intentGlyph)
      ? { repo, sub: intentGlyph.toLowerCase(), subIsGlyph: false }
      : { repo, sub: intentGlyph, subIsGlyph: true };
  }
  const sub = (branchTail.match(ALPHANUM)?.[0] ?? "?").toLowerCase();
  return { repo, sub, subIsGlyph: false };
}
