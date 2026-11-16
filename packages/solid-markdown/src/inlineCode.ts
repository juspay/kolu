/** INLINE CODE A HOST CAN ACT ON — a general hook, not a rule about any one
 *  host's paths.
 *
 *  Prose often names a thing in backticks that the host knows how to open: a
 *  file, a terminal, a command. The renderer cannot know which spans those
 *  are, and must not guess, so the host answers for each span's EXACT text
 *  ({@link InlineCodeAction}), and a span it answers for becomes a real
 *  `<button>` around the same `<code>` — named for the person (its
 *  `aria-label`), reachable by keyboard, and dispatched through the same
 *  click seam as the renderer's links (`data-md-code-action`, read by
 *  `bindMarkdownLinks`). A span the host does not answer for stays plain code.
 *
 *  It runs AFTER the sanitizer, on markup the sanitizer already produced, and
 *  writes only what it builds itself: the code element is moved, never
 *  re-serialized from text, so nothing the prose said can become markup.
 *  Code inside a `<pre>` block is never touched — a block is something to
 *  read, not a name to press. */

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
