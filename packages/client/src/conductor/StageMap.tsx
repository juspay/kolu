/** THE STAGE MAP — a waterfall's six stages in fixed places, drawn on every
 *  card, row and work chip: Plan, Approve, Build, Checks and Merge in a row,
 *  Review above Build, with arrows between them.
 *
 *  The stage is WHO HOLDS THE WORK (`kolu-work`'s `stages`), so a work goes
 *  back and forth: Review and Build loop once per review round, Build and
 *  Checks once per CI run that sent it back, and Approve and Plan once per
 *  plan you asked to change. A loop that has been walked says how many times
 *  (`×6`), counted off the work's trail (`movedTimes`) — never kept by hand.
 *  A count a doubt may hide more of is a lower bound (`×6+`), or unknown
 *  (`×?`).
 *
 *  Each stage carries its name and, once it has had any, its total time over
 *  every visit. A RING is on where the work is: one box for a stage, both
 *  for a doubt between two. Inside a ringed box, a third line says how long
 *  this visit has been (`now 8m`) when that is not the whole of its time. A
 *  finished work's last stage has a bold name and says so in its title. A
 *  stage whose time was not recorded — a work saved before kolu kept
 *  hand-offs, which a DOUBT between two stages may have been — is HATCHED,
 *  its name on a plain plate; the doubt itself is a mark between its two
 *  boxes, with the time the two took together (`▨ 1h 20m`). A stage the mode
 *  does not have, or the work went past, is DASHED; one not reached is
 *  FAINT. A colour names a stage — the same colour as on the trail
 *  (`STAGE_INK`) — and every stage also says, in its title and to a screen
 *  reader, its time, whose time it mostly was, where it stands and how many
 *  times the work was in it, so nothing is said by colour alone.
 *
 *  A NARROW MAP (under 18rem of its own width, a container query) cannot fit
 *  five names beside four arrows, two of them counting a loop, so each name
 *  is its first letter — P, A, B, R, C, M are six different letters — and
 *  the third line and a doubt's time are not drawn; the title has them.
 *
 *  ONE COMPONENT, TWO SIZES: `full` on a card, `mini` inside a work chip's
 *  hover card. On a card it is also an INDEX INTO THE TIMELINE: a stage that
 *  has happened, and a doubt's mark, is a button showing its events, and the
 *  one shown is filled with its colour at low strength — never ringed, so
 *  the ring only ever means where the work is. A mode with no stages (a
 *  plain watch) draws no map; a work whose mode nobody has answered draws
 *  six faint stages until it is known.
 *
 *  `<For keyed={false}>`, because a stage's POSITION is its identity — the
 *  six never move — and the fold mints fresh objects every tick of the
 *  clock. */

import { compactPhrase, dualPhrase } from "@kolu/terminal-vocab/duration";
import {
  canBe,
  type Count,
  type Doubt,
  DOUBTS,
  doubtsOf,
  movedTimes,
  STAGES,
  type Stage,
  stageMs,
  type StageName,
  type Stages,
  type StageState,
  visitedTimes,
  type Waiter,
  type Where,
} from "kolu-work";
import { type Component, createMemo, For, Show } from "solid-js";
import { HATCH, NOW_RING, STAGE_INK, STAGE_LABEL } from "./workReadings";

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

/** Whose time a stage mostly was, in words — the colour no longer says it. */
const WHOSE: Record<Waiter, string> = {
  agent: "the agents' time",
  you: "your time",
  ci: "CI's time",
};

/** A COUNT AS AN ARROW WRITES IT, and as its data attributes carry it: `0`,
 *  `2`, `2+` for at least two, `?` for at least none. An arrow draws no
 *  count that is known to be none. */
export const countText = (count: Count): string => {
  if (count.kind === "exactly") return `${count.times}`;
  return count.times === 0 ? "?" : `${count.times}+`;
};

/** Whether a count is known to be none. */
const isNone = (count: Count): boolean =>
  count.kind === "exactly" && count.times === 0;

/** ... and as a stage's sentence says how many times the work was in it:
 *  nothing for once or never, else `2 times`, `at least once`, `at least 2
 *  times`, or `an unknown number of times`. */
const countWords = (count: Count): ReadonlyArray<string> => {
  if (count.kind === "exactly")
    return count.times > 1 ? [`${count.times} times`] : [];
  if (count.times === 0) return ["an unknown number of times"];
  return [
    count.times === 1 ? "at least once" : `at least ${count.times} times`,
  ];
};

/** A box's look, by where its stage stands: hatched may have been a doubt's
 *  time; dashed did not happen; faint is not reached yet. The ring and the
 *  "shown" fill are where the work is and what the timeline shows, added on
 *  top. */
const boxInk = (name: StageName, state: StageState): string => {
  switch (state.kind) {
    case "now":
    case "done":
      return STAGE_INK[name].edge;
    case "unrecorded":
      return `${HATCH.edge} ${HATCH.fill}`;
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
 *  stage, and the doubts it visited with their time. */
interface MapReading {
  readonly cells: ReadonlyArray<Stage>;
  readonly where: Where | undefined;
  readonly moved: (from: StageName, to: StageName) => Count;
  readonly visits: (stage: StageName) => Count;
  readonly doubt: (doubt: Doubt) => number | undefined;
}

const NONE: Count = { kind: "exactly", times: 0 };

const readingOf = (stages: Stages): MapReading | undefined => {
  switch (stages.kind) {
    case "none":
      return undefined;
    case "unset":
      return {
        cells: QUIET,
        where: undefined,
        moved: () => NONE,
        visits: () => NONE,
        doubt: () => undefined,
      };
    case "staged": {
      const doubts = doubtsOf(stages.trail);
      return {
        cells: stages.stages,
        where: stages.where,
        moved: (from, to) => movedTimes(stages.trail, from, to),
        visits: (stage) => visitedTimes(stages.trail, stage),
        doubt: (doubt) => doubts.find((one) => one.doubt === doubt)?.ms,
      };
    }
    default:
      return stages satisfies never;
  }
};

/** ONE SENTENCE PER STAGE — its name and total time, whose time it mostly
 *  was, where it stands, this visit's time when that is not the whole, that
 *  the work ended there, and how many times the work was in it. It is both
 *  what a screen reader hears and the stage's title on hover, so the two
 *  cannot drift apart. */
const spokenOf = (stage: Stage, visits: Count, ended: boolean): string => {
  const state = stage.state;
  const had = state.kind === "done" || state.kind === "now";
  return [
    had
      ? `${STAGE_LABEL[stage.name]} ${dualPhrase(state.ms)}`
      : STAGE_LABEL[stage.name],
    ...(had ? [WHOSE[state.who]] : []),
    STATE_WORD[state.kind],
    ...(state.kind === "now" && state.here !== state.ms
      ? [`${dualPhrase(state.here)} this time`]
      : []),
    ...(ended ? ["the work ended here"] : []),
    ...countWords(visits),
  ].join(", ");
};

/** A DOUBT'S MARK, between its two boxes: a hatched swatch and the time the
 *  two stages took together, which is known though the split is not. On a
 *  card it is a button showing the doubt's events. Under 18rem the time is
 *  not drawn; the title has it. */
const DoubtMark: Component<{
  doubt: Doubt;
  ms: number;
  pick?: { readonly shown: boolean; readonly show: () => void };
}> = (props) => {
  const spoken = () =>
    `${STAGE_LABEL[props.doubt]}, ${dualPhrase(props.ms)}. kolu did not record which.`;
  const face = () => (
    <>
      <span
        aria-hidden="true"
        class={`inline-block h-2 w-2 shrink-0 rounded-[2px] border ${HATCH.edge} ${HATCH.fill}`}
      />
      <span
        data-testid="stage-doubt-time"
        aria-hidden="true"
        class="hidden whitespace-nowrap tabular-nums @min-[18rem]/map:inline"
      >
        {compactPhrase(props.ms)}
      </span>
    </>
  );
  const ink =
    "inline-flex items-center gap-0.5 rounded-sm px-0.5 font-mono text-[0.5rem] leading-tight text-fg-2";
  return (
    <Show
      when={props.pick}
      fallback={
        <span
          data-testid="stage-doubt"
          data-doubt={props.doubt}
          title={spoken()}
          class={ink}
        >
          {face()}
          <span class="sr-only">{spoken()}</span>
        </span>
      }
    >
      {(pick) => (
        <button
          type="button"
          data-testid="stage-doubt"
          data-doubt={props.doubt}
          title={spoken()}
          aria-label={spoken()}
          aria-pressed={pick().shown}
          class={`${ink} cursor-pointer hover:brightness-125 ${
            pick().shown ? STAGE_INK[props.doubt].tint : ""
          }`}
          onClick={() => pick().show()}
        >
          {face()}
        </button>
      )}
    </Show>
  );
};

/** WHAT EACH CELL BETWEEN TWO BOXES HOLDS, as {@link PLACE} says where each
 *  box sits: its arrow from one stage to the other — `one` way, a `loop`
 *  counted both ways once the work has gone back, or Review's `rounds` up
 *  and down over Build — and, when the two are a doubt's stages, that
 *  doubt's mark. */
interface Between {
  readonly testId: string;
  readonly col: number;
  readonly row: number;
  readonly from: StageName;
  readonly to: StageName;
  readonly way: "one" | "loop" | "rounds";
}
const BETWEEN: ReadonlyArray<Between> = [
  {
    testId: "stage-arrow-plan-approve",
    col: 2,
    row: 3,
    from: "plan",
    to: "approve",
    way: "loop",
  },
  {
    testId: "stage-arrow-approve-build",
    col: 4,
    row: 3,
    from: "approve",
    to: "build",
    way: "one",
  },
  {
    testId: "stage-arrow-build-review",
    col: 5,
    row: 2,
    from: "build",
    to: "review",
    way: "rounds",
  },
  {
    testId: "stage-arrow-build-checks",
    col: 6,
    row: 3,
    from: "build",
    to: "checks",
    way: "loop",
  },
  {
    testId: "stage-arrow-checks-merge",
    col: 8,
    row: 3,
    from: "checks",
    to: "merge",
    way: "one",
  },
];

/** The doubt between a cell's two stages, if they are one's — read off
 *  `kolu-work`'s doubts, never a second list here. */
const doubtOf = (cell: Between): Doubt | undefined =>
  DOUBTS.find(
    (doubt) =>
      canBe(doubt).includes(cell.from) && canBe(doubt).includes(cell.to),
  );

/** AN ARROW between two boxes. A LOOP says, once the way back is not known
 *  to be none, how many times each way: `→×2` over `←×1`; Review's ROUNDS
 *  say `↑↓ ×6`. Drawn, not spoken — each stage's own sentence says how many
 *  times the work was in it. When the cell's stages are a doubt's that the
 *  work visited, its mark sits under the arrow. */
const Arrow: Component<{
  cell: Between;
  moved: (from: StageName, to: StageName) => Count;
  mark: { readonly doubt: Doubt; readonly ms: number } | undefined;
  pick: { readonly shown: boolean; readonly show: () => void } | undefined;
}> = (props) => {
  const forward = createMemo(() => props.moved(props.cell.from, props.cell.to));
  const back = createMemo(() => props.moved(props.cell.to, props.cell.from));
  const mark = createMemo(() => props.mark);
  const glyphs = () => {
    switch (props.cell.way) {
      case "one":
        return <span aria-hidden="true">→</span>;
      case "rounds":
        return (
          <>
            <span aria-hidden="true">↑↓</span>
            <Show when={isNone(forward()) ? undefined : countText(forward())}>
              {(count) => <span aria-hidden="true">×{count()}</span>}
            </Show>
          </>
        );
      case "loop":
        return (
          <Show
            when={!isNone(back())}
            fallback={<span aria-hidden="true">→</span>}
          >
            <span aria-hidden="true" class="whitespace-nowrap">
              →×{countText(forward())}
            </span>
            <span aria-hidden="true" class="whitespace-nowrap">
              ←×{countText(back())}
            </span>
          </Show>
        );
      default:
        return props.cell.way satisfies never;
    }
  };
  return (
    <li
      aria-hidden={mark() === undefined ? "true" : undefined}
      data-testid={props.cell.testId}
      data-forward={
        props.cell.way === "loop" ? countText(forward()) : undefined
      }
      data-back={props.cell.way === "loop" ? countText(back()) : undefined}
      data-rounds={
        props.cell.way === "rounds" ? countText(forward()) : undefined
      }
      style={{
        "grid-column": `${props.cell.col}`,
        "grid-row": `${props.cell.row}`,
      }}
      class={`flex items-center justify-center font-mono text-[0.5rem] leading-tight text-fg-3 ${
        props.cell.way === "rounds" ? "gap-1" : "flex-col px-0.5"
      }`}
    >
      {glyphs()}
      <Show when={mark()}>
        {(one) => (
          <DoubtMark doubt={one().doubt} ms={one().ms} pick={props.pick} />
        )}
      </Show>
    </li>
  );
};

const StageMap: Component<{
  /** The work's stages, read once by the face that draws the map. */
  stages: Stages;
  size: "full" | "mini";
  /** What the map is found by: a card's own, or the copy in a chip's hover
   *  card — never one test id in two places on one screen. */
  testId: "stage-map" | "chip-stage-map";
  /** ON A CARD, THE MAP IS AN INDEX INTO THE TIMELINE: a stage that has
   *  happened, and a doubt's mark, is a button showing its events, and the
   *  one shown is pressed. Absent in a chip's hover card, where they stay
   *  plain. */
  index?: {
    readonly shown: () => StageName | Doubt | undefined;
    readonly show: (place: StageName | Doubt) => void;
  };
}> = (props) => {
  const reading = createMemo(() => readingOf(props.stages));
  const full = () => props.size === "full";
  /** The boxes where the work is: every stage its place can be. */
  const ringed = (name: StageName): boolean => {
    const where = reading()?.where;
    return where?.kind === "in" && canBe(where.place).includes(name);
  };
  /** ... and, on a finished work, where it ended. */
  const ended = (name: StageName): boolean => {
    const where = reading()?.where;
    return where?.kind === "ended-in" && canBe(where.place).includes(name);
  };
  /** A cell's doubt mark as a button, on a card. */
  const pickOf = (cell: Between) => {
    const doubt = doubtOf(cell);
    const index = props.index;
    return doubt === undefined || index === undefined
      ? undefined
      : { shown: index.shown() === doubt, show: () => index.show(doubt) };
  };
  /** A cell's doubt mark, when the work visited that doubt. */
  const markOf = (cell: Between) => {
    const doubt = doubtOf(cell);
    const ms = doubt === undefined ? undefined : reading()?.doubt(doubt);
    return doubt === undefined || ms === undefined ? undefined : { doubt, ms };
  };
  return (
    <Show when={reading()}>
      {(read) => (
        <div
          data-testid={props.testId}
          class={`@container/map min-w-0 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <ol
            aria-label="Stages"
            class="m-0 grid min-w-0 list-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-y-0.5 p-0"
          >
            <For each={read().cells} keyed={false}>
              {(stage) => {
                const state = () => stage().state;
                const name = () => stage().name;
                const had = () =>
                  state().kind === "done" || state().kind === "now";
                const emphasis = () => ringed(name()) || ended(name());
                const spoken = () =>
                  spokenOf(stage(), read().visits(name()), ended(name()));
                /** This visit's time, when it is not the whole of the
                 *  stage's. */
                const here = () => {
                  const now = state();
                  return now.kind === "now" && now.here !== now.ms
                    ? now.here
                    : undefined;
                };
                const face = () => (
                  <>
                    <span
                      data-testid="stage-label"
                      data-stage={name()}
                      data-emphasis={emphasis() ? "" : undefined}
                      class={`block whitespace-nowrap font-mono leading-tight ${
                        full() ? "text-[0.55rem]" : "text-[0.5rem]"
                      } ${
                        state().kind === "unrecorded"
                          ? `mx-auto w-fit rounded-sm px-0.5 ${
                              full() ? "bg-surface-0" : "bg-surface-2"
                            }`
                          : ""
                      } ${
                        emphasis()
                          ? "font-semibold text-fg"
                          : state().kind === "skipped"
                            ? "text-fg-3/60"
                            : "text-fg-2"
                      }`}
                    >
                      {STAGE_LABEL[name()].slice(0, 1)}
                      <span class="hidden @min-[18rem]/map:inline">
                        {STAGE_LABEL[name()].slice(1)}
                      </span>
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
                    {/* THE TIME IN HAND, inside the ring, only when it is
                        not the whole of the stage's: one visit says it
                        once. */}
                    <Show when={here()}>
                      {(ms) => (
                        <span
                          data-testid="stage-now"
                          data-stage={name()}
                          class={`hidden whitespace-nowrap font-mono tabular-nums leading-tight text-fg @min-[18rem]/map:block ${
                            full() ? "text-[0.5rem]" : "text-[0.46rem]"
                          }`}
                        >
                          now {compactPhrase(ms())}
                        </span>
                      )}
                    </Show>
                    <span class="sr-only">{spoken()}</span>
                  </>
                );
                const box = (shown: boolean) =>
                  `relative block w-full min-w-0 rounded-md border px-0.5 text-center ${
                    full() ? "py-0.5" : "py-px"
                  } ${boxInk(name(), state())} ${
                    ringed(name()) ? NOW_RING : ""
                  } ${shown ? STAGE_INK[name()].tint : ""}`;
                return (
                  <li
                    data-testid="stage"
                    data-stage={name()}
                    data-state={state().kind}
                    title={spoken()}
                    style={{
                      "grid-column": `${PLACE[name()].col}`,
                      "grid-row": `${PLACE[name()].row}`,
                    }}
                    class="min-w-0"
                  >
                    <Show
                      when={had() ? props.index : undefined}
                      fallback={<span class={box(false)}>{face()}</span>}
                    >
                      {(index) => (
                        <button
                          type="button"
                          data-testid="stage-cell"
                          aria-pressed={index().shown() === name()}
                          class={`${box(index().shown() === name())} cursor-pointer hover:brightness-125`}
                          onClick={() => index().show(name())}
                        >
                          {face()}
                        </button>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
            {/* THE CELLS BETWEEN THE BOXES: the arrows, and each doubt's
                mark between its two stages. */}
            <For each={BETWEEN}>
              {(cell) => (
                <Arrow
                  cell={cell}
                  moved={read().moved}
                  mark={markOf(cell)}
                  pick={pickOf(cell)}
                />
              )}
            </For>
          </ol>
        </div>
      )}
    </Show>
  );
};

export default StageMap;
