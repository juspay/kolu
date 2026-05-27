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
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { intentLeadGlyph } from "../../intent/text";

const ASCII_ALPHANUM = /^[a-z0-9]$/i;

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
  const repo = (info.key.group.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const branchTail = info.key.label.split("/").pop() ?? info.key.label;
  const intentGlyph = meta.intent ? intentLeadGlyph(meta.intent) : "";
  if (intentGlyph) {
    return ASCII_ALPHANUM.test(intentGlyph)
      ? { repo, sub: intentGlyph.toLowerCase(), subIsGlyph: false }
      : { repo, sub: intentGlyph, subIsGlyph: true };
  }
  const sub = (branchTail.match(/[a-z0-9]/i)?.[0] ?? "?").toLowerCase();
  return { repo, sub, subIsGlyph: false };
}
