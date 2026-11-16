/** THE STAGE STRIP — a waterfall's six stages, always in the same order:
 *  Plan, Approve, Build, Review, Checks, Merge.
 *
 *  Each cell says how long that stage has taken and is coloured by whose
 *  time it is (`WAITER_INK`): the agents', yours, or CI's. The stage the work
 *  is in now is outlined, and takes the colour of who it is waiting on — a
 *  build or a review stopped on a question is yours. A stage that did not
 *  happen (no planner, so no plan) is a dashed cell with a dash; one not
 *  reached yet is empty. The stages are `kolu-work`'s own fold (`stages`),
 *  over the same walk as the standing line, so the strip and the sentence
 *  over it cannot disagree.
 *
 *  A plain watch is not a waterfall and draws no strip at all; a work whose
 *  mode nobody has answered draws six quiet cells until it is known.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card's shut face, `mini` inside a
 *  work chip's hover card. Read aloud it is a list named "Stages", each cell
 *  its stage, its time, whose time it is and where it stands.
 *
 *  `<Index>`, because a cell's POSITION is its identity — the six stages
 *  never move — and the fold mints fresh objects every tick of the clock. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
import {
  STAGE_WAITER,
  STAGES,
  type Stage,
  type StageState,
  type Waiter,
  type Work,
} from "kolu-work";
import { type Component, createMemo, Index, Show } from "solid-js";
import { STAGE_LABEL, stagesOf, WAITER_INK } from "./workReadings";

/** The cell's colours, by where its stage stands. */
const cellInk = (state: StageState, own: Waiter): string => {
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

/** Whose time a stage is, as a screen reader hears it — what the colour
 *  says to everybody else. */
const WHOSE: Record<Waiter, string> = {
  agent: "the agents' time",
  you: "your time",
  ci: "CI's time",
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

/** Six quiet cells, for a work whose mode is not known yet. */
const QUIET: ReadonlyArray<Stage> = STAGES.map((name) => ({
  name,
  state: { kind: "not-started" },
}));

const StageStrip: Component<{
  work: Work;
  /** The clock the stages are measured to. */
  now: number;
  size: "full" | "mini";
}> = (props) => {
  const read = createMemo(() =>
    stagesOf(props.work, new Date(props.now).toISOString()),
  );
  const cells = createMemo((): ReadonlyArray<Stage> | undefined => {
    const one = read();
    switch (one.kind) {
      case "watch":
        return undefined;
      case "unset":
        return QUIET;
      case "waterfall":
        return one.stages;
      default:
        return one satisfies never;
    }
  });
  const full = () => props.size === "full";
  return (
    <Show when={cells()}>
      {(all) => (
        <ol
          data-testid="stage-strip"
          data-size={props.size}
          data-run={read().kind}
          aria-label="Stages"
          class={`m-0 grid list-none grid-cols-6 gap-[3px] p-0 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <Index each={all()}>
            {(stage) => {
              const state = () => stage().state;
              const ran = () =>
                state().kind === "done" || state().kind === "now";
              /** Whose time the cell is: the stage's own waiter, or — for
               *  the stage the work is in — whoever it is waiting on now. */
              const who = () => {
                const now = state();
                return now.kind === "now"
                  ? now.who
                  : STAGE_WAITER[stage().name];
              };
              return (
                <li
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
                  <span class="sr-only">
                    {ran() ? `, ${WHOSE[who()]}, ` : ", "}
                    {STATE_WORD[state().kind]}
                  </span>
                </li>
              );
            }}
          </Index>
        </ol>
      )}
    </Show>
  );
};

export default StageStrip;
