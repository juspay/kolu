/** Pure renderer for the first-grapheme glyph of a terminal's intent —
 *  one of three intent rendering tiers (the others being
 *  `IntentMarkdownBlock` for full prose and the inline-pill rendering
 *  in the workspace switcher card). Owns the unset fallback
 *  (`<Show when>`) so each call site is a one-liner.
 *
 *  Takes a scalar `intent: string | undefined`. The component delegates
 *  glyph extraction to `intentLeadGlyph` in `./text`, which is the same
 *  helper the dock rail chip uses — so both surfaces agree on what the
 *  intent's lead glyph is.
 *
 *  Co-located with the rest of the intent rendering tier in
 *  `packages/client/src/intent/` so a change to how intent is
 *  visualized at the glyph scale lands next to the other tiers, not in
 *  the unrelated `terminal/` directory. */

import { type Component, Show, createMemo } from "solid-js";
import { intentLeadGlyph } from "./text";

const IntentGlyph: Component<{
  intent: string | undefined;
  /** Tailwind size + spacing applied to the outer span. */
  class?: string;
}> = (props) => {
  const glyph = createMemo(() =>
    props.intent ? intentLeadGlyph(props.intent) : "",
  );
  return (
    <Show when={glyph()}>
      {(g) => (
        <span
          data-testid="intent-glyph"
          class={props.class ?? "text-sm leading-none shrink-0"}
          aria-hidden="true"
        >
          {g()}
        </span>
      )}
    </Show>
  );
};

export default IntentGlyph;
