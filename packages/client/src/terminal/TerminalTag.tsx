/** Pure renderer for a terminal's intent tag — the first grapheme
 *  cluster of `intent`, displayed as a small inline glyph. Owns the
 *  unset fallback (`<Show when>`) so each call site is a one-liner.
 *
 *  Takes a scalar `intent: string | undefined`. The component does the
 *  first-grapheme extraction itself — call sites pass `meta.intent`
 *  directly. */

import { type Component, Show, createMemo } from "solid-js";
import { firstIntentLine } from "../intent/text";

/** Extract the first grapheme cluster from a string. Falls back to the
 *  first codepoint when `Intl.Segmenter` isn't available (e.g. very
 *  old runtimes). Empty input returns the empty string. */
function firstGrapheme(s: string): string {
  if (s.length === 0) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(s)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...s][0] ?? "";
}

const TerminalTag: Component<{
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
          data-testid="terminal-tag"
          class={props.class ?? "text-sm leading-none shrink-0"}
          aria-hidden="true"
        >
          {g()}
        </span>
      )}
    </Show>
  );
};

export default TerminalTag;
