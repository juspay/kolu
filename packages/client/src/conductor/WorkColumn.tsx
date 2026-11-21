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
 *  terminals and age side by side (`WorkCard`'s two shapes). On a phone,
 *  where there is no side to put anything beside, every work is a card.
 *
 *  WITH NOTHING IN FLIGHT, it says so in a sentence, never `0`. */

import { Key } from "@solid-primitives/keyed";
import { finished, inProgress, type Work, type WorkRow } from "kolu-work";
import { type Component, createEffect, createMemo, Show } from "solid-js";
import { layoutMode } from "../useMobile";
import { useNeedsYou, useWorks } from "./useWorks";
import WorkCard from "./WorkCard";
import {
  isFinishedOpen,
  openFinished,
  toggleFinished,
  wantedCard,
} from "./workListing";
import { WAITER_INK } from "./workReadings";

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
 *  Cards stand apart; rows are one table, its lines ruled. */
const Works: Component<{
  rows: ReadonlyArray<WorkRow>;
  shape: "card" | "row";
}> = (props) => (
  <div
    class={
      props.shape === "row"
        ? "flex flex-col divide-y divide-edge overflow-hidden rounded-xl border border-edge"
        : "flex flex-col gap-2"
    }
  >
    <Key each={props.rows} by={([id]) => id}>
      {(row) => <WorkCard id={row()[0]} work={row()[1]} shape={props.shape} />}
    </Key>
  </div>
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

  return (
    <div data-testid="work-column" class="min-w-0 bg-surface-0 px-4 py-3">
      {/* THE QUIET LINE IS ABOUT WHAT IS IN FLIGHT, which is what the list
          is for: a conversation whose waterfalls have all landed is a
          conversation with nothing in progress, and saying so is more use
          than a list that is merely history. The finished works keep their
          place BELOW that line rather than standing in for it. */}
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
            <Heading words={`In progress · ${groups().moving.length}`} />
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
        {/* FINISHED IS SHUT BY DEFAULT. It is history: worth having, never
            worth the top of the list. One press opens it; each work in it
            opens on its own, as a live one does. */}
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
            <Works rows={done()} shape="card" />
          </Show>
        </section>
      </Show>
    </div>
  );
};

export default WorkColumn;
