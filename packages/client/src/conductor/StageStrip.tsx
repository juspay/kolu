/** THE STAGE STRIP — a waterfall's six stages, always in the same order:
 *  Plan, Approve, Build, Review, Checks, Merge.
 *
 *  Each cell says how long that stage has taken and is coloured by whose
 *  time it mostly was (`WAITER_INK`): the agents', yours, or CI's. The stage
 *  the work is in now is outlined, in the colour of who it is waiting on. A
 *  stage that did not happen is a dashed cell with a dash: one the work's
 *  mode does not have (a trivial work is never planned or reviewed), or one
 *  it went past. One not reached yet is empty. The stages are `kolu-work`'s
 *  own fold (`stages`, over its mode's row of `MODE_RUNS`), over the same
 *  walk as the standing line, so the strip and the sentence over it cannot
 *  disagree.
 *
 *  A mode with no stages (a plain watch) draws no strip at all; a work whose
 *  mode nobody has answered draws six quiet cells until it is known.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card, `mini` inside a work chip's
 *  hover card. Read aloud it is a list named "Stages", each cell its stage,
 *  its time, whose time it is and where it stands. On a card it is also the
 *  INDEX INTO THE TIMELINE: a cell that has happened is a button showing that
 *  stage's events, and the stage shown is pressed.
 *
 *  `<Index>`, because a cell's POSITION is its identity — the six stages
 *  never move — and the fold mints fresh objects every tick of the clock. */

import { compactPhrase, dualPhrase } from "@kolu/terminal-vocab/duration";
import {
  STAGES,
  type Stage,
  type StageName,
  type Stages,
  type StageState,
  type Waiter,
} from "kolu-work";
import { type Component, createMemo, Index, Show } from "solid-js";
import { STAGE_LABEL, WAITER_INK } from "./workReadings";

/** The cell's colours, by where its stage stands — a stage that has had time
 *  in the colour of whose time it was. */
const cellInk = (state: StageState): string => {
  switch (state.kind) {
    case "now":
      return WAITER_INK[state.who].now;
    case "done":
      return `border-transparent ${WAITER_INK[state.who].tint}`;
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

/** The time a cell shows: how long it has taken, in ONE unit (`14h`, so
 *  every cell is one line), a dash for a stage that did not happen, nothing
 *  for one not reached yet. The exact time is {@link exactOf}. */
const timeOf = (state: StageState): string => {
  switch (state.kind) {
    case "done":
    case "now":
      return compactPhrase(state.ms);
    case "skipped":
      return "–";
    case "not-started":
      return "";
    default:
      return state satisfies never;
  }
};

/** The exact time a stage took (`14h 20m`), for the cell's title and what a
 *  screen reader hears; none for a stage that had no time. */
const exactOf = (state: StageState): string | undefined =>
  state.kind === "done" || state.kind === "now"
    ? dualPhrase(state.ms)
    : undefined;

/** Six quiet cells, for a work whose mode is not known yet. */
const QUIET: ReadonlyArray<Stage> = STAGES.map((name) => ({
  name,
  state: { kind: "not-started" },
}));

const StageStrip: Component<{
  /** The work's stages, read once by the face that draws the strip. */
  stages: Stages;
  size: "full" | "mini";
  /** What the strip is found by: a card's own, or the copy in a chip's
   *  hover card — never one test id in two places on one screen. */
  testId: "stage-strip" | "chip-stage-strip";
  /** ON A CARD, THE STRIP IS THE INDEX INTO THE TIMELINE: a cell that has
   *  happened is a button showing that stage's events, and the one shown is
   *  pressed. Absent in a chip's hover card, where the cells stay plain. */
  index?: {
    readonly shown: () => StageName | undefined;
    readonly show: (stage: StageName) => void;
  };
}> = (props) => {
  const cells = createMemo((): ReadonlyArray<Stage> | undefined => {
    const one = props.stages;
    switch (one.kind) {
      case "none":
        return undefined;
      case "unset":
        return QUIET;
      case "staged":
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
          data-testid={props.testId}
          data-size={props.size}
          data-run={props.stages.kind}
          aria-label="Stages"
          class={`m-0 grid list-none grid-cols-6 gap-[3px] p-0 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <Index each={all()}>
            {(stage) => {
              const state = () => stage().state;
              /** Whose time the cell held, for a stage that had any. */
              const who = (): Waiter | undefined => {
                const now = state();
                return now.kind === "done" || now.kind === "now"
                  ? now.who
                  : undefined;
              };
              const cellClass = () =>
                `relative block w-full min-w-0 rounded-md border text-center ${cellInk(
                  state(),
                )} ${full() ? "py-0.5" : "py-px"}`;
              const face = () => (
                <>
                  <small
                    class={`block truncate leading-tight ${
                      full() ? "text-[0.6rem]" : "text-[0.55rem]"
                    } ${state().kind === "now" ? "font-semibold text-fg" : "text-fg-3"}`}
                  >
                    {STAGE_LABEL[stage().name]}
                  </small>
                  <b
                    aria-hidden="true"
                    class={`block min-h-[1.3em] font-mono font-semibold leading-snug tabular-nums ${
                      full() ? "text-[0.66rem]" : "text-[0.6rem]"
                    } ${who() === undefined ? "text-fg-3" : "text-fg"}`}
                  >
                    {timeOf(state())}
                  </b>
                  <span class="sr-only">
                    {exactOf(state()) ?? ""}
                    {(() => {
                      const whose = who();
                      return whose === undefined ? ", " : `, ${WHOSE[whose]}, `;
                    })()}
                    {STATE_WORD[state().kind]}
                  </span>
                </>
              );
              return (
                <li
                  data-testid="stage"
                  data-stage={stage().name}
                  data-state={state().kind}
                  data-who={who()}
                  title={(() => {
                    const exact = exactOf(state());
                    return exact === undefined
                      ? undefined
                      : `${STAGE_LABEL[stage().name]} ${exact}`;
                  })()}
                  data-shown={
                    props.index?.shown() === stage().name ? "" : undefined
                  }
                  class="min-w-0"
                >
                  <Show
                    when={who() === undefined ? undefined : props.index}
                    fallback={<span class={cellClass()}>{face()}</span>}
                  >
                    {(index) => (
                      <button
                        type="button"
                        data-testid="stage-cell"
                        aria-pressed={index().shown() === stage().name}
                        class={`${cellClass()} cursor-pointer hover:brightness-110 ${
                          index().shown() === stage().name
                            ? "shadow-[0_2px_0_0_currentColor]"
                            : ""
                        }`}
                        onClick={() => index().show(stage().name)}
                      >
                        {face()}
                      </button>
                    )}
                  </Show>
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
