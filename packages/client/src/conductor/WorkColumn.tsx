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
 *  THE SIDEBAR (`WorkRail`) stands beside the works on a desktop, always:
 *  every work, grouped as the board is. A PRESSED WORK IS PICKED: the board
 *  gives way to the picked work beside the sidebar, or, on a phone, to a page
 *  of its own with the way back above it.
 *
 *  WITH NOTHING IN FLIGHT, it says WHAT THE PANEL IS FOR — a welcome, not a
 *  count: never `0`, and never a bare line that teaches nobody anything. */

import {
  finished,
  inProgress,
  type Work,
  type WorkId,
  type WorkRow,
} from "kolu-work";
import type { JSX } from "@solidjs/web";
import {
  type Component,
  createEffect,
  createMemo,
  For,
  onSettled,
  Show,
} from "solid-js";
import { MEMBERSHIP_BOUND_MS } from "../useDeepLinks";
import { layoutMode } from "../useMobile";
import { askFromWelcome } from "./drafts";
import { helpSheet } from "./helpContent";
import { setPhoneView } from "./phoneView";
import { useNeedsYou, useWorks } from "./useWorks";
import WorkCard from "./WorkCard";
import {
  isFinishedOpen,
  pickedWork,
  toggleFinished,
  unpickWork,
} from "./workListing";
import WorkRail, { type RailGroups } from "./WorkRail";
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
  onSettled(() => {
    const box = scroller();
    if (box !== undefined) box.scrollTop = boardScroll;
    return () => {
      boardScroll = scroller()?.scrollTop ?? 0;
    };
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

/** WHAT THE BOARD'S COLOURS OF WAITING MEAN — the standing line's and a
 *  work's dot: who it waits on — and what the map's ring means, said once,
 *  under the works in progress, rather than on every row. A stage's own
 *  colour needs no key: the map names every stage. */
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
    <For each={props.rows} keyed={([id]) => id}>
      {(row) => <WorkCard id={row()[0]} work={row()[1]} shape={props.shape} />}
    </For>
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

/** THE THREE ASKS THE WELCOME OFFERS — requests, not commands: each one says
 *  what to do and where, which is the shape a waterfall needs to start. */
const EXAMPLES: ReadonlyArray<string> = [
  "Fix the failing test in ~/code/myrepo on this machine and open a PR",
  "Plan and build a dark mode toggle for ~/code/myapp",
  "Watch the terminal I have open and tell me when it finishes",
];

/** WHAT THE PANEL SAYS WITH NOTHING IN IT — the whole welcome, shown only
 *  while nothing is in progress. A bare "Nothing in progress." told a
 *  newcomer nothing about what this side of the screen is for; the three
 *  example asks are requests, put into the chat's own draft where a person
 *  can edit them, and pressing one never sends.
 *
 *  The measure is the panel's reading width, not the width of the window: the
 *  works take whatever is left of the frame, which on a wide screen is a lot
 *  of nothing for a paragraph to run across. */
const Welcome: Component = () => {
  const ask = (text: string): void => {
    // A phone shows one of the two views at a time: putting an example into
    // the draft of a chat that is not on screen would be a press with no
    // answer. Show the chat, then put the words in it.
    if (layoutMode() === "phone") setPhoneView("chat");
    askFromWelcome(text);
  };
  return (
    <div data-testid="work-column-empty" class="max-w-[36rem]">
      <h3 class="m-0 text-sm font-semibold text-fg">Nothing in progress</h3>
      <p class="m-0 mt-2 text-[0.8rem] leading-relaxed text-fg-2">
        The Conductor runs coding agents for you. Ask it for something in the
        chat, and each thing it takes on shows up here as a piece of work, with
        its terminals, its questions for you and its pull request.
      </p>
      <p class="m-0 mt-4 mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3">
        Try asking
      </p>
      <div class="flex flex-col items-start gap-1.5">
        <For each={EXAMPLES}>
          {(example) => (
            <button
              type="button"
              data-testid="work-welcome-example"
              class="cursor-pointer rounded-md border border-edge px-2 py-1 text-start text-[0.72rem] text-fg-2 hover:border-edge-bright hover:text-fg"
              onClick={() => ask(example)}
            >
              “{example}”
            </button>
          )}
        </For>
      </div>
      <p class="m-0 mt-4 text-[0.72rem] text-fg-3">
        Press{" "}
        <button
          type="button"
          data-testid="work-welcome-help"
          aria-label="How the Conductor works"
          class="cursor-pointer rounded border border-edge px-1 font-mono text-[0.62rem] text-fg-2 hover:border-edge-bright hover:text-fg"
          onClick={() => helpSheet.openDialog()}
        >
          ?
        </button>{" "}
        for how the Conductor works.
      </p>
    </div>
  );
};

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

  /** Is the picked work in the list right now? */
  const pickedHere = createMemo(() => {
    const id = pickedWork();
    return id !== null && works().some(([one]) => one === id);
  });
  /** THE PICKED WORK, with its record — the last one read while the work is
   *  away from the list. If the work is missing from the mirror for a moment,
   *  a pick that went back to the board each time would draw the work anew
   *  and lose the view it was on. */
  const pickedRow = createMemo((last: WorkRow | undefined) => {
    const id = pickedWork();
    if (id === null) return undefined;
    const now = works().find(([one]) => one === id);
    if (now !== undefined) return now;
    return last?.[0] === id ? last : undefined;
  });
  /** A PICKED WORK THAT IS NOT HERE IS LET GO, after the bound a link waits:
   *  a reload keeps the pick (`workListing.ts`) and the works reach the mirror
   *  one by one after it, and a work can be away for a moment, so a pick
   *  that is not here yet, or not here now, is not one that is gone. One
   *  that stays away — the oldest finished works are let go — is dropped. */
  createEffect(
    () => [pickedWork(), pickedHere()] as const,
    ([id, here]) => {
      if (id === null || here) return;
      const timer = setTimeout(unpickWork, MEMBERSHIP_BOUND_MS);
      return () => clearTimeout(timer);
    },
  );
  /** The sidebar's four groups, each read from its own reading here — the
   *  sidebar draws four fixed places, so nothing here is a list it keys. */
  const railGroups: RailGroups = {
    get waiting() {
      return groups().onYou;
    },
    get moving() {
      return groups().moving;
    },
    get watching() {
      return groups().watching;
    },
    get finished() {
      return done();
    },
  };

  const phone = () => layoutMode() === "phone";

  return (
    // ON A DESKTOP the sidebar stands beside the works and stays where it
    // is; the works beside it are the scrolling box (`data-works-scroll`).
    // On a phone there is no side to put it on: the works' own view is the
    // scrolling box, and a picked work is a page of its own.
    <div
      data-testid="work-column"
      class={`min-w-0 bg-surface-0 ${phone() ? "" : "flex min-h-0 flex-1"}`}
    >
      <Show when={!phone()}>
        <WorkRail groups={railGroups} />
      </Show>
      <div
        data-works-scroll={phone() ? undefined : ""}
        class={
          phone()
            ? "min-w-0"
            : "min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        }
      >
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
                <Show when={live().length > 0} fallback={<Welcome />}>
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
                      <Heading
                        words={`Watching · ${groups().watching.length}`}
                      />
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
              when={!phone()}
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
              <div data-testid="works-picked" class="min-w-0 px-4 py-3">
                <PickedCard id={id} record={pickedRow()?.[1]} />
              </div>
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
};

export default WorkColumn;
