/** Self-contained renderer for the *body* of a terminal's intent —
 *  lines 2+ of the markdown, rendered as a rounded tinted box. Line 1
 *  is the annotation slot (handled by each render site directly), so
 *  the body only shows when the intent has prose past the first line.
 *  Single-line intents collapse to "annotation slot only" with no
 *  body box — keeps the dock + switcher cards compact unless the
 *  user explicitly wrote more.
 *
 *  The box owns its bg/border so a parent's themed wrapper (e.g. the
 *  dock-awaiting card's `theme().bg`) doesn't bleed through and make
 *  this body look different from its siblings. */

import { type Component, Show } from "solid-js";
import { IntentMarkdownBlock } from "./IntentMarkdown";
import { intentBodyMarkdown } from "./text";

const IntentBody: Component<{
  intent: string | undefined;
  testId?: string;
}> = (props) => (
  <Show when={intentBodyMarkdown(props.intent)}>
    {(b) => (
      <div
        data-testid={props.testId}
        class="mt-2 rounded-md border border-edge/70 bg-surface-2/35 px-2 py-1.5 text-[0.72rem] leading-snug text-fg-2"
      >
        <IntentMarkdownBlock markdown={b()} />
      </div>
    )}
  </Show>
);

export default IntentBody;
