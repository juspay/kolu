/** Self-contained renderer for a terminal's full intent markdown — a
 *  rounded box with a subtle border and tinted background, sized for
 *  ~1-3 lines of prose. Used in every dock variant body (Awaiting,
 *  Working, Quiet) and in the workspace switcher card, so the four
 *  render sites visually match regardless of their parent's bg.
 *
 *  The box owns its bg/border so a parent's themed wrapper (e.g. the
 *  dock-awaiting card's `theme().bg`) doesn't bleed through and make
 *  this body look different from its siblings. */

import { type Component, Show } from "solid-js";
import { IntentMarkdownBlock } from "./IntentMarkdown";

const IntentBody: Component<{
  intent: string | undefined;
  testId?: string;
}> = (props) => (
  <Show when={props.intent}>
    {(intent) => (
      <div
        data-testid={props.testId}
        class="mt-2 rounded-md border border-edge/70 bg-surface-2/35 px-2 py-1.5 text-[0.72rem] leading-snug text-fg-2"
      >
        <IntentMarkdownBlock markdown={intent()} />
      </div>
    )}
  </Show>
);

export default IntentBody;
