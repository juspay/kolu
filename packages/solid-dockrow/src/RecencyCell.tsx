/** The row's recency cell — three renderings, ONE `mode` naming which.
 *
 *  · `ago`       — "3m ago", the quiet timestamp
 *  · `hidden`    — nothing (an active terminal is "just now" by definition)
 *  · `wait-chip` — the violet needs-you capsule carrying a DURATION instead of
 *                  a count: how long this agent has been blocked on YOU. A
 *                  20-hour wait must be legible at a glance.
 *
 *  The fixed `w-[8ch]` reserves the widest string the cell can show, so a
 *  changing label never collapses the track or overflows into the next column;
 *  right-aligned so the timestamp lands in one column across rows. That width
 *  contract is the load-bearing no-reflow invariant and lives here alone.
 *
 *  The TEXT arrives already formatted, and that is the seam, not a shortcut: the
 *  strings are read off a CLOCK, and a clock is ambient — a shared ticking
 *  signal whose cadence the consuming app owns (kolu runs a 1 s tick for the
 *  wait chip and a plain `Date.now()` read for "3m ago", deliberately different
 *  subscriptions). A package that reached for a clock would either invent a
 *  second one or force its cadence on every consumer. What is NOT the
 *  consumer's is any of the above: which rendering a row gets ({@link
 *  recencyMode}), which timestamp that rendering means ({@link
 *  displayRecencyAt}), the capsule, and the reserved track. */

import { NeedsYouCapsule } from "@kolu/solid-statepip";
import { type Component, Match, Switch } from "solid-js";

/** The cell's inputs as ONE value — the rendering, and the string computed FOR
 *  that rendering. Separately they are two props a call site can pair wrongly (a
 *  wait duration rendered into the `ago` slot reads as an age and is not one).
 *
 *  A DISCRIMINATED UNION, because `hidden` has no text and a `{ mode, text }`
 *  product made that combination spellable — the caller then had to invent a
 *  filler (`text: ""`) for a slot that means nothing. That is precisely the
 *  shape `recency.ts` argues against one file over: the two booleans it replaced
 *  were "a state machine spelled as flags, one of whose four combinations was
 *  unreachable and another duplicate". Re-opening it here would have been the
 *  same mistake one level up. */
export type RowRecency =
  | { mode: "hidden" }
  | { mode: "ago"; text: string }
  | { mode: "wait-chip"; text: string };

export const RecencyCell: Component<{
  recency: RowRecency;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (`text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
}> = (props) => (
  <span
    class={`inline-flex justify-end w-[8ch] font-mono tabular-nums text-fg-3 ${props.textSize}`}
  >
    <Switch>
      {/* The conditions read `mode` ONLY. Reading `text` here would drag the
       * caller's clock into the Switch's own condition memo — for a wait chip
       * that is a 1 s tick re-evaluating which branch to take, every second,
       * for every blocked row. The text is read inside the branch that renders
       * it, which is where the pre-extraction cell read it too. */}
      <Match when={props.recency.mode === "wait-chip"}>
        {(_) => (
          <NeedsYouCapsule
            testid="dock-wait-chip"
            title="How long this agent has been waiting on your input"
          >
            {props.recency.mode === "wait-chip" ? props.recency.text : ""}
          </NeedsYouCapsule>
        )}
      </Match>
      <Match when={props.recency.mode === "ago"}>
        {(_) => (props.recency.mode === "ago" ? props.recency.text : "")}
      </Match>
    </Switch>
  </span>
);
