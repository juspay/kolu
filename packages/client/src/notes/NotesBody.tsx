/** Self-contained renderer for the *body* of a terminal's notes —
 *  lines 2+ of the markdown, rendered as a rounded tinted box. Line 1
 *  is the annotation slot (handled by each render site directly), so
 *  the body only shows when the notes have prose past the first line.
 *  Single-line notes collapse to "annotation slot only" with no body
 *  box — keeps the switcher card compact unless the user explicitly
 *  wrote more. Today the only render site is the workspace switcher
 *  card (the Notes tab editor shows the raw/preview markdown directly).
 *
 *  The box owns its bg/border so a parent's themed wrapper (e.g. the
 *  switcher card's tinted surface) doesn't bleed through and make this
 *  body look different from its siblings. */

import { type Component, Show } from "solid-js";
import { NotesMarkdownBlock } from "./NotesMarkdown";
import { notesBodyMarkdown } from "./text";

const NotesBody: Component<{
  notes: string | undefined;
  testId?: string;
}> = (props) => (
  <Show when={notesBodyMarkdown(props.notes)}>
    {(b) => (
      <div
        data-testid={props.testId}
        class="mt-2 rounded-md border border-edge/70 bg-surface-2/35 px-2 py-1.5 text-[0.72rem] leading-snug text-fg-2"
      >
        <NotesMarkdownBlock markdown={b()} />
      </div>
    )}
  </Show>
);

export default NotesBody;
