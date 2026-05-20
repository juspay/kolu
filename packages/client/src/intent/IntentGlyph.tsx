/** Pure renderer for the first-grapheme glyph of a terminal's intent —
 *  one of three intent rendering tiers (the others being
 *  `IntentMarkdownBlock` for full prose and the inline-pill rendering
 *  in the workspace switcher card). Owns the unset fallback
 *  (`<Show when>`) so each call site is a one-liner.
 *
 *  Takes a scalar `intent: string | undefined`. The component does the
 *  first-grapheme extraction itself — call sites pass `meta.intent`
 *  directly.
 *
 *  Co-located with the rest of the intent rendering tier in
 *  `packages/client/src/intent/` so a change to how intent is
 *  visualized at the glyph scale lands next to the other tiers, not in
 *  the unrelated `terminal/` directory. */

import { type Component, Show, createMemo } from "solid-js";
import { firstIntentLine } from "./text";

/** Stateless. Hoisted to module scope so `firstGrapheme` doesn't
 *  allocate a new segmenter on every reactive update. Created lazily
 *  inside `firstGrapheme` because `Intl.Segmenter` isn't available in
 *  every runtime (SSR / very old browsers). */
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Extract the first grapheme cluster from a string. Falls back to the
 *  first codepoint when `Intl.Segmenter` isn't available. Empty input
 *  returns the empty string. */
function firstGrapheme(s: string): string {
  if (s.length === 0) return "";
  if (segmenter) {
    const first = segmenter.segment(s)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...s][0] ?? "";
}

const IntentGlyph: Component<{
  intent: string | undefined;
  /** Tailwind size + spacing applied to the outer span. */
  class?: string;
}> = (props) => {
  const glyph = createMemo(() => {
    const i = props.intent;
    if (!i) return "";
    return firstGrapheme(firstIntentLine(i));
  });
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
