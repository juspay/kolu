/** THE WORKS — what the Conductor has in flight, and what it finished: the
 *  wide side of the Conductor's screen, with the chat a panel beside it.
 *
 *  Four groups, in the order a person needs them: "Needs you · N" (the works
 *  the one needs-you reading lists — a question for you, or a merge that is
 *  yours), "In progress" (every other work it is building), "Watching" (the
 *  terminals it is keeping an eye on), then "Finished", collapsed, the most
 *  recently ended first. The first group is cut by the SAME reading the bell,
 *  the tab's count and the palette read, so a work in it is a work that rang.
 *  Within a group the order is the `works` cell's, which kolu-server
 *  publishes oldest first — a work keeps its place while a new one appears
 *  under it; the list does not re-sort what the record already says.
 *
 *  A WORK THAT NEEDS YOU IS A CARD, with its question on it; every other
 *  work in progress is a ROW of its group's table — title, stage line,
 *  terminals and age side by side — and a finished work is a LINE of the
 *  Finished list: title, repository, how it ended, how long it ran and when
 *  (`WorkCard`'s shapes). On a phone, where there is no side to put anything
 *  beside, every work in progress is a card.
 *
 *  A PRESSED WORK IS PICKED: the board gives way to the picked work, with the
 *  others folded to a rail beside it (`WorkRail`), or, on a phone, to a page
 *  of its own with the way back above it.
 *
 *  WITH NOTHING IN FLIGHT, it says so in a sentence, never `0`. */

import { Key } from "@solid-primitives/keyed";
import {
  finished,
  inProgress,
  type Work,
  type WorkId,
  type WorkRow,
} from "kolu-work";
import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { layoutMode } from "../useMobile";
import { useNeedsYou, useWorks } from "./useWorks";
import WorkCard from "./WorkCard";
import {
  isFinishedOpen,
  openFinished,
  pickedWork,
  toggleFinished,
  unpickWork,
  wantedCard,
} from "./workListing";
import WorkRail from "./WorkRail";
import { WAITER_INK } from "./workReadings";

/** Where the board was scrolled to when a work was picked, so going back to
 *  all the works lands where the person left them. */
let boardScroll = 0;

/** THE BOARD KEEPS ITS PLACE across a pick: it is taken down while a work is
 *  picked (a hidden board would draw every work a second time) and its
 *  scroll is put back when it returns. The scroller is the works' own
 *  scrolling box (`data-works-scroll`), which outlives the board. */
const Board: Component<{ children: JSX.Element }> = (props) => {
  let root!: HTMLDivElement;
  const scroller = () =>
    root.closest<HTMLElement>("[data-works-scroll]") ?? undefined;
  onMount(() => {
    const box = scroller();
    if (box !== undefined) box.scrollTop = boardScroll;
  });
  onCleanup(() => {
    boardScroll = scroller()?.scrollTop ?? 0;
  });
  return (
    <div ref={root} data-testid="works-board">
      {props.children}
    </div>
  );
};

const Heading: Component<{ words: string }> = (props) => (
  <h3 class="m-0 mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3">
    {props.words}
  </h3>
);

/** WHAT THE STAGE LINE'S COLOURS MEAN — said once, under the works in
 *  progress, rather than on every row. */
const Legend: Component = () => (
  <p
    data-testid="work-legend"
    class="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[0.58rem] text-fg-3"
  >
    <span>
      <i
        class={`me-1 inline-block h-2 w-2 rounded-sm ${WAITER_INK.agent.fill}`}
      />
      agents
    </span>
    <span>
      <i
        class={`me-1 inline-block h-2 w-2 rounded-sm ${WAITER_INK.you.fill}`}
      />
      you
    </span>
    <span>
      <i class={`me-1 inline-block h-2 w-2 rounded-sm ${WAITER_INK.ci.fill}`} />
      CI
    </span>
    <span>ringed = where it is now</span>
  </p>
);

/** A LIST OF WORKS, KEYED BY THE WORK'S ID. The `works` cell mints a fresh
 *  `[id, work]` row for every change of any work, so a list keyed by the row
 *  would tear every work down — its open details, and a scroll a chip had
 *  just asked for — whenever anything happened anywhere.
 *
 *  Cards stand apart; rows and lines are one table, its lines ruled. */
const Works: Component<{
  rows: ReadonlyArray<WorkRow>;
  shape: "card" | "row" | "line";
}> = (props) => (
  <div
    class={
      props.shape === "card"
        ? "flex flex-col gap-2"
        : "flex flex-col divide-y divide-edge overflow-hidden rounded-xl border border-edge"
    }
  >
    <Key each={props.rows} by={([id]) => id}>
      {(row) => <WorkCard id={row()[0]} work={row()[1]} shape={props.shape} />}
    </Key>
  </div>
);

/** The picked work, drawn while its record is there. */
const PickedCard: Component<{ id: WorkId; record: Work | undefined }> = (
  props,
) => (
  <Show when={props.record}>
    {(work) => <WorkCard id={props.id} work={work()} shape="picked" />}
  </Show>
);

/** A watch keeps an eye on a terminal of yours; it is not building anything. */
const isWatch = (work: Work): boolean => work.key.kind === "watch";

const WorkColumn: Component = () => {
  const works = useWorks();
  const needs = useNeedsYou();
  const live = createMemo(() => inProgress(works()));
  /** On a phone every work is a card: a row needs a side to stand beside. */
  const rowShape = (): "card" | "row" =>
    layoutMode() === "phone" ? "card" : "row";
  /** The groups of what is running, cut by the one needs-you reading. */
  const groups = createMemo(() => {
    const waiting = new Set(needs().map((one) => one.work));
    const onYou: WorkRow[] = [];
    const moving: WorkRow[] = [];
    const watching: WorkRow[] = [];
    for (const row of live()) {
      if (waiting.has(row[0])) onYou.push(row);
      else if (isWatch(row[1])) watching.push(row);
      else moving.push(row);
    }
    return { onYou, moving, watching };
  });
  const done = createMemo(() => finished(works()));
  // A ROUTE TO A FINISHED WORK opens the Finished list, so its card is drawn
  // and can answer the route — `showWork` is the one route and does not ask
  // which list a work sits in.
  createEffect(() => {
    const want = wantedCard();
    if (want !== null && done().some(([id]) => id === want.id)) openFinished();
  });

  /** THE PICKED WORK, with its record — none once it has left the list (the
   *  oldest finished works are let go), which unpicks it. */
  const pickedRow = createMemo((): WorkRow | undefined => {
    const id = pickedWork();
    return id === null ? undefined : works().find(([one]) => one === id);
  });
  createEffect(() => {
    if (pickedWork() !== null && pickedRow() === undefined) unpickWork();
  });
  const railGroups = createMemo(() => [
    { key: "waiting", name: "Needs you", rows: groups().onYou },
    { key: "in-progress", name: "In progress", rows: groups().moving },
    { key: "watching", name: "Watching", rows: groups().watching },
    { key: "finished", name: "Finished", rows: done() },
  ]);

  return (
    <div data-testid="work-column" class="min-w-0 bg-surface-0">
      {/* KEYED BY THE WORK'S ID, not its record: the record is minted fresh
          on every change, and the picked work must not be built again on
          each one — only when another work is picked. */}
      <Show
        when={pickedRow() === undefined ? undefined : pickedWork()}
        keyed
        fallback={
          <Board>
            <div class="px-4 py-3">
              {/* THE QUIET LINE IS ABOUT WHAT IS IN FLIGHT, which is what
                  the list is for: a conversation whose waterfalls have all
                  landed is a conversation with nothing in progress, and
                  saying so is more use than a list that is merely history.
                  The finished works keep their place BELOW that line rather
                  than standing in for it. */}
              <Show
                when={live().length > 0}
                fallback={
                  <p
                    data-testid="work-column-empty"
                    class="m-0 font-mono text-[0.65rem] text-fg-3"
                  >
                    Nothing in progress.
                  </p>
                }
              >
                <Show when={groups().onYou.length > 0}>
                  <section data-testid="work-waiting" class="mb-4">
                    <Heading words={`Needs you · ${groups().onYou.length}`} />
                    <Works rows={groups().onYou} shape="card" />
                  </section>
                </Show>
                <Show when={groups().moving.length > 0}>
                  <section data-testid="work-in-progress" class="mb-4">
                    <Heading
                      words={`In progress · ${groups().moving.length}`}
                    />
                    <Works rows={groups().moving} shape={rowShape()} />
                  </section>
                </Show>
                <Show when={groups().watching.length > 0}>
                  <section data-testid="work-watching" class="mb-4">
                    <Heading words={`Watching · ${groups().watching.length}`} />
                    <Works rows={groups().watching} shape={rowShape()} />
                  </section>
                </Show>
                <Legend />
              </Show>
              <Show when={done().length > 0}>
                {/* FINISHED IS SHUT BY DEFAULT. It is history: worth having,
                    never worth the top of the list. One press opens it; a
                    work in it is picked as a live one is. */}
                <section data-testid="work-finished" class="mt-4">
                  <button
                    type="button"
                    data-testid="work-finished-toggle"
                    aria-expanded={isFinishedOpen()}
                    class="mb-1.5 w-full cursor-pointer text-start font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3 hover:text-fg-2"
                    onClick={toggleFinished}
                  >
                    {isFinishedOpen() ? "▾" : "▸"} Finished · {done().length}
                  </button>
                  <Show when={isFinishedOpen()}>
                    <Works rows={done()} shape="line" />
                  </Show>
                </section>
              </Show>
            </div>
          </Board>
        }
      >
        {(id) => (
          <Show
            when={layoutMode() !== "phone"}
            fallback={
              // ON A PHONE A PICKED WORK IS A PAGE of its own, with the way
              // back above it; the tab bar under it stays.
              <div data-testid="works-picked" class="px-3 py-3">
                <button
                  type="button"
                  data-testid="works-all"
                  class="mb-2 cursor-pointer text-[0.78rem] font-semibold text-accent hover:underline"
                  onClick={() => unpickWork()}
                >
                  ← All work
                </button>
                <PickedCard id={id} record={pickedRow()?.[1]} />
              </div>
            }
          >
            {/* THE OTHER WORKS FOLD TO A RAIL, and the picked one has the
                rest of the room. */}
            <div
              data-testid="works-picked"
              class="grid min-h-full grid-cols-[3.5rem_minmax(0,1fr)] conductor-md:grid-cols-[15rem_minmax(0,1fr)]"
            >
              <WorkRail groups={railGroups()} />
              <div class="min-w-0 px-4 py-3">
                <PickedCard id={id} record={pickedRow()?.[1]} />
              </div>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
};

export default WorkColumn;
