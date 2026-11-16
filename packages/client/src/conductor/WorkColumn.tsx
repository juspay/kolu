/** THE RIGHT COLUMN — what the Conductor has in flight, and what it finished.
 *
 *  Three groups, in the order a person needs them: "Waiting on you" (the
 *  works whose standing is a question for you or a merge that is yours),
 *  then "In progress" (everything else that is running), then "Finished",
 *  collapsed, the most recently ended first. A work moves between the first
 *  two by the same `standing` its card's line reads, so the group and the
 *  words on the card cannot disagree. Within a group the order is the `works`
 *  cell's, which kolu-server publishes oldest first — a card keeps its place
 *  while a new one appears under it; the column does not re-sort what the
 *  record already says.
 *
 *  ONE COMPONENT, TWO PLACEMENTS. On a window wide enough it is the column
 *  beside the conversation; below that width it is the band the status line's
 *  count opens above itself. The rows, the clocks, the open cards and the
 *  Looks are identical, because they are the same component and the same
 *  module state (`./workListing.ts`) — a resize moves the column between the
 *  two with everything a person had open still open.
 *
 *  WITH NOTHING IN IT, it says so in a sentence. The column is on screen
 *  whether or not anything is running — that is what keeps the conversation
 *  from sliding sideways when the first work appears — so what it says when
 *  empty has to be words and not a hole. It never reads `0`. */

import { Key } from "@solid-primitives/keyed";
import { finished, inProgress, type WorkRow } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import { useWorks } from "./useWorks";
import WorkCard from "./WorkCard";
import { isFinishedOpen, toggleFinished } from "./workListing";
import { WAITER_INK, waitsOnYou } from "./workReadings";

const Heading: Component<{ words: string }> = (props) => (
  <h3 class="m-0 mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3">
    {props.words}
  </h3>
);

/** WHAT THE STRIP'S COLOURS MEAN — said once, under the works in progress,
 *  rather than on every card. */
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
    <span>outlined = where it is now</span>
  </p>
);

/** A LIST OF CARDS, KEYED BY THE WORK'S ID. The `works` cell mints a fresh
 *  `[id, work]` row for every change of any work, so a list keyed by the row
 *  would tear every card down — its open rows, and a scroll a chip had just
 *  asked for — whenever anything happened anywhere. */
const Cards: Component<{ rows: ReadonlyArray<WorkRow> }> = (props) => (
  <div class="flex flex-col gap-2">
    <Key each={props.rows} by={([id]) => id}>
      {(row) => <WorkCard id={row()[0]} work={row()[1]} />}
    </Key>
  </div>
);

const WorkColumn: Component<{
  /** WHERE THIS COPY IS DRAWN, and nothing more. `inline` is the band the
   *  status line's control opens below the two-column breakpoint, separated
   *  from the line by its own top edge; `side` is the always-on column beside
   *  the conversation, which already has the frame's own left edge. */
  placement: "inline" | "side";
}> = (props) => {
  const works = useWorks();
  const live = createMemo(() => inProgress(works()));
  /** The two groups of what is running, by the one reading the card's line
   *  makes — each work asked once. */
  const groups = createMemo(() => {
    const onYou: WorkRow[] = [];
    const moving: WorkRow[] = [];
    for (const row of live()) (waitsOnYou(row[1]) ? onYou : moving).push(row);
    return { onYou, moving };
  });
  const done = createMemo(() => finished(works()));

  return (
    <div
      data-testid="work-column"
      data-placement={props.placement}
      // ONE `class` binding, derived from the placement: a `classList` beside
      // a static `class` loses here (Solid applies the static one last and
      // erases the state class), which is the defect `HostChipShell` is the
      // worked example of.
      class={`min-w-0 px-3 py-2 ${props.placement === "inline" ? "border-t border-edge bg-surface-1" : "bg-surface-0"}`}
    >
      {/* THE QUIET LINE IS ABOUT WHAT IS IN FLIGHT, which is what the column
          is for: a conversation whose waterfalls have all landed is a
          conversation with nothing in progress, and saying so is more use
          than a column that is merely a list of history. The finished work
          keeps its place BELOW that line rather than standing in for it. */}
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
            <Heading words="Waiting on you" />
            <Cards rows={groups().onYou} />
          </section>
        </Show>
        <Show when={groups().moving.length > 0}>
          <section data-testid="work-in-progress">
            <Heading words="In progress" />
            <Cards rows={groups().moving} />
          </section>
        </Show>
        <Legend />
      </Show>
      <Show when={done().length > 0}>
        {/* FINISHED IS SHUT BY DEFAULT. It is history: worth having, never
            worth the top of the column. One press opens the list; each card
            in it opens on its own, as a live one does. */}
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
            <Cards rows={done()} />
          </Show>
        </section>
      </Show>
    </div>
  );
};

export default WorkColumn;
