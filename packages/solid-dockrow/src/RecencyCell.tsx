import { NeedsYouCapsule } from "@kolu/solid-statepip";
import { type Component, Match, Switch } from "solid-js";
import type { RowRecency } from "./recency.ts";

export type { RowRecency } from "./recency.ts";

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
