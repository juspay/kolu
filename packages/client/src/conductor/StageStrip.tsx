/** THE STAGE STRIP — a waterfall's six stages, always in the same order:
 *  Plan, Approve, Build, Review, Checks, Merge — drawn as ONE THIN LINE.
 *
 *  Each segment is coloured by whose time its stage mostly was
 *  (`WAITER_INK`): the agents', yours, or CI's. Under every bar is its
 *  stage's name, and under a stage that has HAD time is that time too
 *  (`Plan 4m`, `Build 1h 2m`, `Checks 16m`, from `dualPhrase` — the strip's
 *  own small mono, no hover needed; the title repeats both for the mouse).
 *  Two bars of one colour are read as two stages that had the same person's
 *  time, never as the same stage twice. The stage the work is in now is the
 *  segment that is marked, its label is the emphasised one, and its time is
 *  the one that keeps growing; on a finished work the last stage that
 *  happened carries that emphasis instead. A stage that did not happen is a
 *  dashed segment, its label dimmed: one the work's mode does not have (a
 *  trivial work is never planned or reviewed), or one it went past. One not
 *  reached yet is a quiet segment with its label alone and no time. The
 *  stages are `kolu-work`'s own fold
 *  (`stages`, over its mode's row of `MODE_RUNS`), over the same walk as the
 *  standing line, so the strip and the sentence over it cannot disagree.
 *
 *  A mode with no stages (a plain watch) draws no strip at all; a work whose
 *  mode nobody has answered draws six quiet segments until it is known.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card, `mini` inside a work chip's
 *  hover card. Read aloud it is a list named "Stages", each segment its stage,
 *  its time, whose time it is and where it stands — the same sentence its
 *  title prints on hover, so the colour's meaning is never sight-only. On a
 *  card it is also the INDEX INTO THE TIMELINE: a segment that has happened is
 *  a button showing that stage's events, and the stage shown is pressed.
 *
 *  A segment's box is `relative`: its spoken label is an `sr-only` span, which
 *  is positioned against the nearest positioned ancestor, and a segment that
 *  was not one let that span be placed against the pane — which then grew
 *  taller than the window.
 *
 *  `<Index>`, because a segment's POSITION is its identity — the six stages
 *  never move — and the fold mints fresh objects every tick of the clock. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
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

/** THE COLOUR RULE, in one place — THE INK SAYS WHOSE TIME THE STAGE WAS.
 *  Teal (accent) was the agents', violet (alert) was yours, amber
 *  (attention) was CI's (`WAITER_INK`, `workReadings.ts`). Nothing else is
 *  carried by colour: the bar's ring says this is the stage the work is in,
 *  dimming says the stage is past, a DASHED outline says the stage did not
 *  happen, and a faint grey says it has not been reached. Every one of those
 *  is also in the segment's title and spoken label, and every segment names
 *  its stage under the bar — so colour is never the only carrier, and no two
 *  meanings share an ink. The last stage of a merged or closed work keeps
 *  that same waiter's ink: it is one more stage that had somebody's time, not
 *  a fourth colour. */
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

/** ONE SENTENCE PER STAGE — its name and time, whose time it was, and where
 *  it stands. It is both what a screen reader hears and what the bar's title
 *  says on hover, so the colour's meaning is available in words everywhere
 *  the colour is drawn, and the two cannot drift apart. */
const spokenOf = (name: StageName, state: StageState): string => {
  const exact = exactOf(state);
  const whose =
    state.kind === "done" || state.kind === "now" ? state.who : null;
  return [
    exact === undefined ? STAGE_LABEL[name] : `${STAGE_LABEL[name]} ${exact}`,
    ...(whose === null ? [] : [WHOSE[whose]]),
    STATE_WORD[state.kind],
  ].join(", ");
};

/** Six quiet segments, for a work whose mode is not known yet. */
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
  /** THE STAGE THE EYE SHOULD LAND ON: the one the work is in, or — for a
   *  work with no current stage, which is a finished one — the last stage
   *  that happened. Its label is the emphasised one. */
  const emphasis = createMemo((): StageName | undefined => {
    const all = cells();
    if (all === undefined) return undefined;
    for (const stage of all) if (stage.state.kind === "now") return stage.name;
    let last: StageName | undefined;
    for (const stage of all) if (stage.state.kind === "done") last = stage.name;
    return last;
  });
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
                    {/* THE STAGE'S NAME, under its bar, in the strip's own
                        small mono. It is the one thing the colors cannot say:
                        two bars of the same ink are two stages that had the
                        same person's time, and this is how the eye tells them
                        apart. `truncate` keeps it on one line at phone width;
                        the full name is in the segment's title either way. */}
                    <span
                      data-testid="stage-label"
                      data-stage={stage().name}
                      data-emphasis={
                        emphasis() === stage().name ? "" : undefined
                      }
                      class={`block w-full truncate whitespace-nowrap pt-0.5 text-center font-mono leading-tight ${
                        full() ? "text-[0.55rem]" : "text-[0.5rem]"
                      } ${
                        emphasis() === stage().name
                          ? "font-semibold text-fg"
                          : state().kind === "skipped"
                            ? "text-fg-3/60"
                            : "text-fg-3"
                      }`}
                    >
                      {STAGE_LABEL[stage().name]}
                    </span>
                    {/* HOW LONG THAT STAGE HAD — every stage the work has
                        been in, not only the current one, and without a
                        hover. It sits on its own line under the label so a
                        phone-width column clips the label rather than the
                        time; an unreached (or skipped) stage has none. The
                        current stage's number grows with the clock the card
                        reads it on. */}
                    <Show when={exactOf(state())}>
                      {(time) => (
                        <span
                          data-testid="stage-time"
                          data-stage={stage().name}
                          class={`block w-full truncate whitespace-nowrap text-center font-mono tabular-nums leading-tight text-fg-3 ${
                            full() ? "text-[0.5rem]" : "text-[0.46rem]"
                          }`}
                        >
                          {time()}
                        </span>
                      )}
                    </Show>
                    <span class="sr-only">
                      {spokenOf(stage().name, state())}
                    </span>
                  </>
                );
                return (
                  <li
                    data-testid="stage"
                    data-stage={stage().name}
                    data-state={state().kind}
                    data-who={who()}
                    title={spokenOf(stage().name, state())}
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
        </div>
      )}
    </Show>
  );
};

export default StageStrip;
