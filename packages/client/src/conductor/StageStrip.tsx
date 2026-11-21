/** THE STAGE STRIP — a waterfall's six stages, always in the same order:
 *  Plan, Approve, Build, Review, Checks, Merge — drawn as ONE THIN LINE.
 *
 *  Each segment is coloured by whose time its stage mostly was
 *  (`WAITER_INK`): the agents', yours, or CI's. The stage the work is in now
 *  is the segment that is marked, and it is the one stage NAMED, beside the
 *  line, with its time (`Review · 3m`) — the other five say nothing on screen,
 *  so the line reads at a glance and the name says where the work is. A stage
 *  that did not happen is a dashed segment: one the work's mode does not have
 *  (a trivial work is never planned or reviewed), or one it went past. One not
 *  reached yet is a quiet segment. The stages are `kolu-work`'s own fold
 *  (`stages`, over its mode's row of `MODE_RUNS`), over the same walk as the
 *  standing line, so the strip and the sentence over it cannot disagree.
 *
 *  A mode with no stages (a plain watch) draws no strip at all; a work whose
 *  mode nobody has answered draws six quiet segments until it is known.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card, `mini` inside a work chip's
 *  hover card. Read aloud it is a list named "Stages", each segment its stage,
 *  its time, whose time it is and where it stands — every stage is spoken,
 *  though only one is named on screen. On a card it is also the INDEX INTO THE
 *  TIMELINE: a segment that has happened is a button showing that stage's
 *  events, and the stage shown is pressed.
 *
 *  A segment's box is `relative`: its spoken label is an `sr-only` span, which
 *  is positioned against the nearest positioned ancestor, and a segment that
 *  was not one let that span be placed against the pane — which then grew
 *  taller than the window.
 *
 *  `<Index>`, because a segment's POSITION is its identity — the six stages
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

/** The segment's colour, by where its stage stands — a stage that has had
 *  time in the colour of whose time it was, the current one at full strength
 *  and ringed. */
const segmentInk = (state: StageState): string => {
  switch (state.kind) {
    case "now":
      return `${WAITER_INK[state.who].fill} ring-1 ring-fg/70 ring-offset-1 ring-offset-surface-0`;
    case "done":
      return `${WAITER_INK[state.who].fill} opacity-55`;
    case "not-started":
      return "bg-fg-3/15";
    case "skipped":
      return "border border-dashed border-edge-bright";
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

/** The exact time a stage took (`14h 20m`), for the segment's title and what
 *  a screen reader hears; none for a stage that had no time. */
const exactOf = (state: StageState): string | undefined =>
  state.kind === "done" || state.kind === "now"
    ? dualPhrase(state.ms)
    : undefined;

/** Six quiet segments, for a work whose mode is not known yet. */
const QUIET: ReadonlyArray<Stage> = STAGES.map((name) => ({
  name,
  state: { kind: "not-started" },
}));

/** THE STAGE THE WORK IS IN, as the words beside the line: its name and how
 *  long it has had, in one unit (`Review · 3m`). None while no stage is
 *  current. */
const nowOf = (
  all: ReadonlyArray<Stage>,
): { readonly words: string; readonly who: Waiter } | undefined => {
  for (const stage of all) {
    if (stage.state.kind === "now")
      return {
        words: `${STAGE_LABEL[stage.name]} · ${compactPhrase(stage.state.ms)}`,
        who: stage.state.who,
      };
  }
  return undefined;
};

const StageStrip: Component<{
  /** The work's stages, read once by the face that draws the strip. */
  stages: Stages;
  size: "full" | "mini";
  /** What the strip is found by: a card's own, or the copy in a chip's
   *  hover card — never one test id in two places on one screen. */
  testId: "stage-strip" | "chip-stage-strip";
  /** ON A CARD, THE STRIP IS THE INDEX INTO THE TIMELINE: a segment that has
   *  happened is a button showing that stage's events, and the one shown is
   *  pressed. Absent in a chip's hover card, where the segments stay plain. */
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
        <div
          data-testid={props.testId}
          data-size={props.size}
          data-run={props.stages.kind}
          class={`flex min-w-0 items-center gap-2 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <ol
            aria-label="Stages"
            class="m-0 grid min-w-0 flex-1 list-none grid-cols-6 gap-[3px] p-0"
          >
            <Index each={all()}>
              {(stage) => {
                const state = () => stage().state;
                /** Whose time the segment held, for a stage that had any. */
                const who = (): Waiter | undefined => {
                  const now = state();
                  return now.kind === "done" || now.kind === "now"
                    ? now.who
                    : undefined;
                };
                /** The box a press lands on is taller than the line it
                 *  draws: a 6px target is a target nobody hits. */
                const boxClass = () =>
                  `relative block w-full min-w-0 ${full() ? "py-1" : "py-0.5"}`;
                const face = () => (
                  <>
                    <span
                      aria-hidden="true"
                      class={`block w-full rounded-full ${
                        full() ? "h-1.5" : "h-1"
                      } ${segmentInk(state())}`}
                    />
                    <span class="sr-only">
                      {(() => {
                        const exact = exactOf(state());
                        const whose = who();
                        return [
                          exact === undefined
                            ? STAGE_LABEL[stage().name]
                            : `${STAGE_LABEL[stage().name]} ${exact}`,
                          ...(whose === undefined ? [] : [WHOSE[whose]]),
                          STATE_WORD[state().kind],
                        ].join(", ");
                      })()}
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
                      fallback={<span class={boxClass()}>{face()}</span>}
                    >
                      {(index) => (
                        <button
                          type="button"
                          data-testid="stage-cell"
                          aria-pressed={index().shown() === stage().name}
                          class={`${boxClass()} cursor-pointer rounded-sm hover:brightness-125 ${
                            index().shown() === stage().name
                              ? "outline outline-1 outline-offset-1 outline-fg-2"
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
          {/* THE ONE STAGE NAMED — what a person reads without decoding the
              colours. The list above already speaks every stage, so this is
              for the eye alone. */}
          <Show when={nowOf(all())}>
            {(now) => (
              <span
                data-testid="stage-now"
                aria-hidden="true"
                class={`shrink-0 whitespace-nowrap font-mono font-semibold tabular-nums ${
                  full() ? "text-[0.62rem]" : "text-[0.58rem]"
                } ${WAITER_INK[now().who].text}`}
              >
                {now().words}
              </span>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default StageStrip;
