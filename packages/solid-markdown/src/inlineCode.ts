/** A host's word on one inline code span: how a press on it is named, and
 *  whether it is the one the host has open now (`aria-current`). */
export interface InlineCodeAction {
  readonly label: string;
  readonly current: boolean;
}

/** `html` with every inline `<code>` whose whole text `actionOf` answers for
 *  wrapped in a button that says so. The same string when nothing matched. */
export function decorateInlineCode(
  html: string,
  actionOf: (text: string) => InlineCodeAction | undefined,
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  let changed = false;
  for (const code of template.content.querySelectorAll("code")) {
    if (code.closest("pre") !== null) continue;
    const text = code.textContent ?? "";
    const action = actionOf(text);
    if (action === undefined) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-md-code-action", text);
    button.setAttribute("aria-label", action.label);
    button.title = action.label;
    if (action.current) button.setAttribute("aria-current", "true");
    code.replaceWith(button);
    button.append(code);
    changed = true;
  }
  return changed ? template.innerHTML : html;
}
