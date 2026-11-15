/** THE RIGHT COLUMN — what the Conductor has in flight, and what it finished.
 *
 *  One card per piece of work in progress, oldest first so a card keeps its
 *  place while a new one appears under it; then "Finished", collapsed, the
 *  most recently ended first. Both lists come straight off the `works` cell,
 *  which kolu-server publishes in exactly that order — the column does not
 *  re-sort what the record already says.
 *
 *  ONE COMPONENT, TWO PLACEMENTS. On a window wide enough it is the column
 *  beside the conversation; below that width it is the band the status line's
 *  count opens above itself. The rows, the clocks, the open cards and the
 *  Looks are identical, because they are the same component and the same
 *  module state — a resize moves the column between the two with everything a
 *  person had open still open.
 *
 *  WITH NOTHING IN IT, it says so in a sentence. The column is on screen
 *  whether or not anything is running — that is what keeps the conversation
 *  from sliding sideways when the first work appears — so what it says when
 *  empty has to be words and not a hole. It never reads `0`. */

import { finished, inProgress } from "kolu-work";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { useWorks } from "./useWorks";
import WorkCard from "./WorkCard";

/** IS THE FINISHED LIST OPEN — module state, for the reason the open cards
 *  are: the column moves between its two placements on a resize, and what a
 *  person opened must survive the move. */
const [showFinished, setShowFinished] = createSignal(false);

const Heading: Component<{ words: string }> = (props) => (
  <h3 class="m-0 mb-1.5 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3">
    {props.words}
  </h3>
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
        <Heading words="In progress" />
        <div class="flex flex-col gap-2">
          <For each={live()}>
            {([id, work]) => <WorkCard id={id} work={work} />}
          </For>
        </div>
      </Show>
      <Show when={done().length > 0}>
        {/* FINISHED IS SHUT BY DEFAULT. It is history: worth having, never
            worth the top of the column. One press opens the list; each card
            in it opens on its own, as a live one does. */}
        <section data-testid="work-finished" class="mt-4">
          <button
            type="button"
            data-testid="work-finished-toggle"
            aria-expanded={showFinished()}
            class="mb-1.5 w-full cursor-pointer text-start font-mono text-[0.58rem] uppercase tracking-[0.12em] text-fg-3 hover:text-fg-2"
            onClick={() => setShowFinished(!showFinished())}
          >
            {showFinished() ? "▾" : "▸"} Finished · {done().length}
          </button>
          <Show when={showFinished()}>
            <div class="flex flex-col gap-2">
              <For each={done()}>
                {([id, work]) => <WorkCard id={id} work={work} />}
              </For>
            </div>
          </Show>
        </section>
      </Show>
    </div>
  );
};

export default WorkColumn;
