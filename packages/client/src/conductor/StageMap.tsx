/** THE STAGE MAP — a waterfall's six stages in fixed places, drawn on every
 *  card, row and work chip: Plan, Approve, Build, Checks and Merge in a row,
 *  Review above Build, with arrows between them.
 *
 *  The stage is WHO HOLDS THE WORK (`kolu-work`'s `stages`), so a work goes
 *  back and forth: Review and Build loop once per review round, Build and
 *  Checks once per CI run that sent it back, and Approve and Plan once per
 *  plan you asked to change. A loop that has been walked says how many times
 *  (`×6`), counted off the work's trail (`movesOf`) — never kept by hand.
 *
 *  Each stage carries its name and, once it has had any, its total time over
 *  every visit. A RING is on the stage the work is in, with how long it has
 *  been in it this time; on a finished work the stage it ended in is the
 *  emphasised one. A Build or Review whose time nobody recorded (a work saved
 *  before kolu kept hand-offs) is HATCHED, as that stretch is on the trail.
 *  A stage the mode does not have, or the work went past, is DASHED; one not
 *  reached is FAINT. A colour names a stage — the same colour
 *  as on the trail (`STAGE_INK`) — and every stage also says, in its title
 *  and to a screen reader, its time, whose time it mostly was, where it
 *  stands and how many times the work was in it, so nothing is said by
 *  colour alone.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card, `mini` inside a work chip's
 *  hover card. On a card it is also an INDEX INTO THE TIMELINE: a stage that
 *  has happened is a button showing that stage's events, and the stage shown
 *  is pressed. A mode with no stages (a plain watch) draws no map; a work
 *  whose mode nobody has answered draws six faint stages until it is known.
 *
 *  `<Index>`, because a stage's POSITION is its identity — the six never
 *  move — and the fold mints fresh objects every tick of the clock. */

import { compactPhrase, dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import {
  type Filed,
  movesOf,
  STAGES,
  type Stage,
  stageMs,
  type StageName,
  type Stages,
  type StageState,
  type Waiter,
} from "kolu-work";
import { type Component, createMemo, Index, Show } from "solid-js";
import { visitMs } from "./trailView";
import { STAGE_INK, STAGE_LABEL } from "./workReadings";

/** WHERE EACH STAGE SITS on the map's grid: five in a row, Review above
 *  Build. Columns alternate stage and arrow. */
const PLACE: Record<StageName, { readonly col: number; readonly row: number }> =
  {
    plan: { col: 1, row: 3 },
    approve: { col: 3, row: 3 },
    build: { col: 5, row: 3 },
    review: { col: 5, row: 1 },
    checks: { col: 7, row: 3 },
    merge: { col: 9, row: 3 },
  };

/** What a screen reader hears after the stage and its time. */
const STATE_WORD: Record<StageState["kind"], string> = {
  done: "done",
  now: "now",
  unrecorded: "not recorded",
  "not-started": "not started",
  skipped: "did not happen",
};

/** The hatch a stage whose time nobody recorded is drawn in — the trail's
 *  hatch for that stretch, faint enough to read the stage's name over. */
const UNRECORDED_HATCH =
  "bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--color-fg-3)_30%,transparent)_0_2px,transparent_2px_5px)]";

/** The ring on what the work is in now. */
const RING = "ring-2 ring-fg ring-offset-1 ring-offset-surface-0";

/** Whose time a stage mostly was, in words — the colour no longer says it. */
const WHOSE: Record<Waiter, string> = {
  agent: "the agents' time",
  you: "your time",
  ci: "CI's time",
};

/** A box's look, by where its stage stands. The ring is the stage the work
 *  is in; hatched is a time nobody recorded (ringed, both of the two it may
 *  have been, while the work is in it); dashed did not happen; faint is not
 *  reached yet. */
const boxInk = (name: StageName, state: StageState): string => {
  switch (state.kind) {
    case "now":
      return `${STAGE_INK[name].edge} ${RING}`;
    case "done":
      return STAGE_INK[name].edge;
    case "unrecorded":
      return `${STAGE_INK.unrecorded.edge} ${UNRECORDED_HATCH} ${state.now ? RING : ""}`;
    case "not-started":
      return "border-edge opacity-60";
    case "skipped":
      return "border-dashed border-edge-bright";
    default:
      return state satisfies never;
  }
};

/** Six faint stages, for a work whose mode is not known yet. */
const QUIET: ReadonlyArray<Stage> = STAGES.map((name) => ({
  name,
  state: { kind: "not-started" },
}));

/** What the map reads off one `Stages`: its cells, where the work is (or
 *  ended), how many times it moved each way, how many times it was in each
 *  stage, and how long it has been in the stage it is in now. */
interface MapReading {
  readonly cells: ReadonlyArray<Stage>;
  readonly current: Filed | undefined;
  readonly moved: (from: Filed, to: Filed) => number;
  readonly visits: (stage: StageName) => number;
  readonly hereFor: number | undefined;
}

const readingOf = (stages: Stages): MapReading | undefined => {
  switch (stages.kind) {
    case "none":
      return undefined;
    case "unset":
      return {
        cells: QUIET,
        current: undefined,
        moved: () => 0,
        visits: () => 0,
        hereFor: undefined,
      };
    case "staged": {
      const moves = movesOf(stages.trail);
      const last = stages.trail.at(-1);
      return {
        cells: stages.stages,
        current: stages.current,
        moved: (from, to) =>
          moves.find((one) => one.from === from && one.to === to)?.times ?? 0,
        visits: (stage) =>
          stages.trail.filter((one) => one.stage === stage).length,
        hereFor:
          last !== undefined && Option.isNone(last.until)
            ? visitMs(last)
            : undefined,
      };
    }
    default:
      return stages satisfies never;
  }
};

/** ONE SENTENCE PER STAGE — its name and total time, whose time it mostly
 *  was, where it stands, and how many times the work was in it. It is both
 *  what a screen reader hears and the stage's title on hover, so the two
 *  cannot drift apart. */
const spokenOf = (stage: Stage, visits: number): string => {
  const state = stage.state;
  const had = state.kind === "done" || state.kind === "now";
  return [
    had
      ? `${STAGE_LABEL[stage.name]} ${dualPhrase(state.ms)}`
      : STAGE_LABEL[stage.name],
    ...(had ? [WHOSE[state.who]] : []),
    STATE_WORD[state.kind],
    ...(state.kind === "unrecorded" && state.now ? ["now"] : []),
    ...(visits > 1 ? [`${visits} times`] : []),
  ].join(", ");
};

/** AN ARROW between two places on the map, and the count once its loop has
 *  been walked: `→`, or `→ ×2` over `← ×1`. Drawn, not spoken — each stage's
 *  own sentence says how many times the work was in it. */
const Arrow: Component<{
  col: number;
  forward: number;
  back: number;
  loops: boolean;
  testId: string;
}> = (props) => (
  <li
    aria-hidden="true"
    data-testid={props.testId}
    data-forward={props.forward}
    data-back={props.back}
    style={{ "grid-column": `${props.col}`, "grid-row": "3" }}
    class="flex flex-col items-center justify-center px-0.5 font-mono text-[0.5rem] leading-tight text-fg-3"
  >
    <Show when={props.loops && props.back > 0} fallback={<span>→</span>}>
      <span class="whitespace-nowrap">→×{props.forward}</span>
      <span class="whitespace-nowrap">←×{props.back}</span>
    </Show>
  </li>
);

const StageMap: Component<{
  /** The work's stages, read once by the face that draws the map. */
  stages: Stages;
  size: "full" | "mini";
  /** What the map is found by: a card's own, or the copy in a chip's hover
   *  card — never one test id in two places on one screen. */
  testId: "stage-map" | "chip-stage-map";
  /** ON A CARD, THE MAP IS AN INDEX INTO THE TIMELINE: a stage that has
   *  happened is a button showing that stage's events, and the one shown is
   *  pressed. Absent in a chip's hover card, where the stages stay plain. */
  index?: {
    readonly shown: () => StageName | undefined;
    readonly show: (stage: StageName) => void;
  };
}> = (props) => {
  const reading = createMemo(() => readingOf(props.stages));
  const full = () => props.size === "full";
  /** THE STAGE THE EYE SHOULD LAND ON: the one the work is in, or the one a
   *  finished work ended in. */
  const emphasis = (): StageName | undefined => {
    const current = reading()?.current;
    return current === undefined ||
      current === "setup" ||
      current === "unrecorded"
      ? undefined
      : current;
  };
  return (
    <Show when={reading()}>
      {(read) => (
        <div
          data-testid={props.testId}
          data-size={props.size}
          data-run={props.stages.kind}
          class={`min-w-0 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <ol
            aria-label="Stages"
            class="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-y-0.5 p-0"
          >
            <Index each={read().cells}>
              {(stage) => {
                const state = () => stage().state;
                const name = () => stage().name;
                const had = () =>
                  state().kind === "done" || state().kind === "now";
                const spoken = () => spokenOf(stage(), read().visits(name()));
                const face = () => (
                  <>
                    <span
                      data-testid="stage-label"
                      data-stage={name()}
                      data-emphasis={emphasis() === name() ? "" : undefined}
                      class={`block whitespace-nowrap font-mono leading-tight ${
                        full() ? "text-[0.55rem]" : "text-[0.5rem]"
                      } ${
                        emphasis() === name()
                          ? "font-semibold text-fg"
                          : state().kind === "skipped"
                            ? "text-fg-3/60"
                            : "text-fg-2"
                      }`}
                    >
                      {STAGE_LABEL[name()]}
                    </span>
                    {/* ITS TIME, over every visit — one unit, because a cut
                        duration is a wrong number; the exact time is in the
                        title. A stage that has had none says nothing. */}
                    <Show
                      when={had() ? compactPhrase(stageMs(state())) : undefined}
                    >
                      {(time) => (
                        <span
                          data-testid="stage-time"
                          data-stage={name()}
                          class={`block whitespace-nowrap font-mono tabular-nums leading-tight text-fg-3 ${
                            full() ? "text-[0.5rem]" : "text-[0.46rem]"
                          }`}
                        >
                          {time()}
                        </span>
                      )}
                    </Show>
                    <span class="sr-only">{spoken()}</span>
                  </>
                );
                const box = () =>
                  `relative block w-full min-w-0 rounded-md border px-0.5 text-center ${
                    full() ? "py-0.5" : "py-px"
                  } ${boxInk(name(), state())} ${
                    emphasis() === name() && state().kind === "done"
                      ? "border-2"
                      : ""
                  }`;
                return (
                  <li
                    data-testid="stage"
                    data-stage={name()}
                    data-state={state().kind}
                    data-who={(() => {
                      const now = state();
                      return now.kind === "done" || now.kind === "now"
                        ? now.who
                        : undefined;
                    })()}
                    data-shown={
                      props.index?.shown() === name() ? "" : undefined
                    }
                    title={spoken()}
                    style={{
                      "grid-column": `${PLACE[name()].col}`,
                      "grid-row": `${PLACE[name()].row}`,
                    }}
                    class="min-w-0"
                  >
                    <Show
                      when={had() ? props.index : undefined}
                      fallback={<span class={box()}>{face()}</span>}
                    >
                      {(index) => (
                        <button
                          type="button"
                          data-testid="stage-cell"
                          aria-pressed={index().shown() === name()}
                          class={`${box()} cursor-pointer hover:brightness-125 ${
                            index().shown() === name()
                              ? "outline outline-1 outline-offset-1 outline-fg-2"
                              : ""
                          }`}
                          onClick={() => index().show(name())}
                        >
                          {face()}
                        </button>
                      )}
                    </Show>
                    {/* HOW LONG IT HAS BEEN HERE THIS TIME — under the ring
                        only, so the total above and the stretch in hand are
                        never confused. */}
                    <Show
                      when={
                        state().kind === "now" && read().hereFor !== undefined
                          ? read().hereFor
                          : undefined
                      }
                    >
                      {(ms) => (
                        <span
                          data-testid="stage-now"
                          class={`block whitespace-nowrap text-center font-mono tabular-nums leading-tight text-fg ${
                            full() ? "text-[0.5rem]" : "text-[0.46rem]"
                          }`}
                        >
                          now · {compactPhrase(ms())}
                        </span>
                      )}
                    </Show>
                  </li>
                );
              }}
            </Index>
            {/* THE ARROWS. Review sits over Build, so its loop runs up and
                down between them and says how many rounds it has had. */}
            <Arrow
              col={2}
              forward={read().moved("plan", "approve")}
              back={read().moved("approve", "plan")}
              loops
              testId="stage-arrow-plan-approve"
            />
            <Arrow
              col={4}
              forward={read().moved("approve", "build")}
              back={0}
              loops={false}
              testId="stage-arrow-approve-build"
            />
            <li
              aria-hidden="true"
              data-testid="stage-arrow-build-review"
              data-rounds={read().moved("build", "review")}
              style={{ "grid-column": "5", "grid-row": "2" }}
              class="flex items-center justify-center gap-1 font-mono text-[0.5rem] leading-tight text-fg-3"
            >
              <span>↑↓</span>
              <Show when={read().moved("build", "review") > 0}>
                <span>×{read().moved("build", "review")}</span>
              </Show>
            </li>
            <Arrow
              col={6}
              forward={read().moved("build", "checks")}
              back={read().moved("checks", "build")}
              loops
              testId="stage-arrow-build-checks"
            />
            <Arrow
              col={8}
              forward={read().moved("checks", "merge")}
              back={0}
              loops={false}
              testId="stage-arrow-checks-merge"
            />
          </ol>
        </div>
      )}
    </Show>
  );
};

export default StageMap;
