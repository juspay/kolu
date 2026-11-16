/** THE STAGE STRIP — a work's six stages, always in the same order: Plan,
 *  Approve, Build, Review, Checks, Merge.
 *
 *  Each cell says how long that stage has taken and is coloured by whose
 *  time it is (`WAITER_INK`): the agents', yours, or CI's. The stage the work
 *  is in now is outlined, and takes the colour of who it is waiting on — a
 *  build stopped on a question is yours. A stage that did not happen (no
 *  planner, so no plan) is a dashed cell with a dash; one not reached yet is
 *  empty. The stages are `kolu-work`'s own fold (`stages`), over the same
 *  walk as the standing line, so the strip and the sentence over it cannot
 *  disagree about where the work is.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card's shut face, `mini` inside a
 *  work chip's hover card. Read aloud, each cell is its stage, its time and
 *  where it stands.
 *
 *  `<Index>`, because a cell's POSITION is its identity — the six stages
 *  never move — and the fold mints fresh objects every tick of the clock. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { STAGE_WAITER, type StageState, type Work } from "kolu-work";
import { type Component, createMemo, Index } from "solid-js";
import { STAGE_LABEL, stagesOf, WAITER_INK } from "./workReadings";

/** The cell's colours, by where its stage stands. */
const cellInk = (state: StageState, own: keyof typeof WAITER_INK): string => {
  switch (state.kind) {
    case "now":
      return WAITER_INK[state.who].now;
    case "done":
      return `border-transparent ${WAITER_INK[own].tint}`;
    case "not-started":
      return "border-transparent bg-fg-3/10";
    case "skipped":
      return "border-dashed border-edge-bright";
    default:
      return state satisfies never;
  }
};

/** What a screen reader hears after the stage and its time. */
const STATE_WORD: Record<StageState["kind"], string> = {
  done: "done",
  now: "now",
  "not-started": "not started",
  skipped: "did not happen",
};

/** The time a cell shows: how long it has taken, a dash for a stage that did
 *  not happen, nothing for one not reached yet. */
const timeOf = (state: StageState): string => {
  switch (state.kind) {
    case "done":
    case "now":
      return dualPhrase(state.ms);
    case "skipped":
      return "–";
    case "not-started":
      return "";
    default:
      return state satisfies never;
  }
};

const StageStrip: Component<{
  work: Work;
  /** The clock the stages are measured to. */
  now: number;
  size: "full" | "mini";
}> = (props) => {
  const strip = createMemo(() =>
    stagesOf(props.work, new Date(props.now).toISOString()),
  );
  const full = () => props.size === "full";
  return (
    <span
      data-testid="stage-strip"
      data-size={props.size}
      class={`grid grid-cols-6 gap-[3px] ${full() ? "mt-2" : "mt-1.5"}`}
    >
      <Index each={strip()}>
        {(stage) => {
          const state = () => stage().state;
          const ran = () => state().kind === "done" || state().kind === "now";
          /** Whose time the cell is: the stage's own waiter, or — for the
           *  stage the work is in — whoever it is waiting on now. */
          const who = () => {
            const now = state();
            return now.kind === "now" ? now.who : STAGE_WAITER[stage().name];
          };
          return (
            <span
              data-testid="stage"
              data-stage={stage().name}
              data-state={state().kind}
              data-who={who()}
              class={`block min-w-0 rounded-md border text-center ${cellInk(
                state(),
                STAGE_WAITER[stage().name],
              )} ${full() ? "py-0.5" : "py-px"}`}
            >
              <small
                class={`block truncate leading-tight ${
                  full() ? "text-[0.6rem]" : "text-[0.55rem]"
                } ${state().kind === "now" ? "font-semibold text-fg" : "text-fg-3"}`}
              >
                {STAGE_LABEL[stage().name]}
              </small>
              <b
                class={`block min-h-[1.3em] font-mono font-semibold leading-snug tabular-nums ${
                  full() ? "text-[0.66rem]" : "text-[0.6rem]"
                } ${ran() ? "text-fg" : "text-fg-3"}`}
              >
                {timeOf(state())}
              </b>
              <span class="sr-only">{STATE_WORD[state().kind]}</span>
            </span>
          );
        }}
      </Index>
    </span>
  );
};

export default StageStrip;
