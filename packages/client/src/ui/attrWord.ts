/** THE WORD AN ATTRIBUTE CARRIES, not the boolean behind it.
 *
 *  Solid renders a boolean handed to a plain attribute as PRESENCE: `true`
 *  writes the attribute empty (`data-touch=""`) and `false` removes it. That
 *  is right for the attributes HTML defines as boolean (`disabled`, `open`,
 *  `hidden`) and wrong for every `data-*` whose value is read as a word — a
 *  Tailwind `data-[touch=true]:` variant, a CSS `[data-x="true"]` selector or
 *  a step asking `getAttribute` for `"true"` all want the four letters, and
 *  an empty value matches none of them.
 *
 *  So a `data-*` carrying a flag spells its word rather than leaning on the
 *  renderer's boolean rule — here where the flag's absence is also its off
 *  state, and inline (`flag ? "true" : "false"`) where the attribute reports
 *  the fact both ways. */

/** `"true"` while the flag holds, and NO attribute otherwise, so `[data-x]`
 *  and `hasAttribute` still answer the flag. */
export const trueWord = (flag: boolean | undefined): "true" | undefined =>
  flag ? "true" : undefined;
