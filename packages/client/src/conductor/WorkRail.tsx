/** THE RAIL — the other works, folded to one line each beside the picked one,
 *  grouped as the board is, so a person can jump from one work to another
 *  without going back to all of them. Below 1280px it is a strip of initials,
 *  each with the dot that says who the work is waiting on.
 *
 *  A rail line is a way to a work, not the work: it carries no `work-card`
 *  test id and no `data-work`, which belong to the picked work alone. */

import { Option } from "effect";
import type { WorkId, WorkRow } from "kolu-work";
import { type Component, For, Show } from "solid-js";
import { isPicked, pickWork, unpickWork } from "./workListing";
import { standingLine, WORK_DOT } from "./workReadings";

/** A work's initials — its first two words' first letters. */
function initialsOf(title: string): string {
  const words = title.split(/\s+/).filter((one) => one !== "");
  return words
    .slice(0, 2)
    .map((one) => one.charAt(0).toUpperCase())
    .join("");
}

const Line: Component<{ id: WorkId; row: WorkRow }> = (props) => {
  const who = () => standingLine(props.row[1], Option.none()).who;
  return (
    <button
      type="button"
      data-testid="works-rail-line"
      data-rail-work={props.id}
      aria-current={isPicked(props.id) ? "true" : undefined}
      title={props.row[1].title}
      class={`flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-start text-[0.72rem] hover:bg-surface-2 ${
        isPicked(props.id) ? "bg-surface-2 font-semibold text-fg" : "text-fg-2"
      }`}
      onClick={() => pickWork(props.id)}
    >
      <span class={`h-2 w-2 shrink-0 rounded-full ${WORK_DOT[who()]}`} />
      <span class="hidden min-w-0 flex-1 truncate conductor-md:block">
        {props.row[1].title}
      </span>
      <span
        aria-hidden="true"
        class="font-mono text-[0.62rem] conductor-md:hidden"
      >
        {initialsOf(props.row[1].title)}
      </span>
    </button>
  );
};

const WorkRail: Component<{
  groups: ReadonlyArray<{
    /** The board group it mirrors, as data: `waiting`, `in-progress`,
     *  `watching` or `finished`. */
    readonly key: string;
    readonly name: string;
    readonly rows: ReadonlyArray<WorkRow>;
  }>;
}> = (props) => (
  <nav
    data-testid="works-rail"
    aria-label="Works"
    class="flex min-w-0 flex-col gap-3 border-e border-edge px-1.5 py-3"
  >
    <button
      type="button"
      data-testid="works-all"
      aria-label="All work"
      class="cursor-pointer rounded-md px-2 py-1 text-start text-[0.72rem] font-semibold text-accent hover:bg-surface-2"
      onClick={() => unpickWork()}
    >
      <span aria-hidden="true" class="hidden conductor-md:inline">
        ← All work
      </span>
      <span aria-hidden="true" class="conductor-md:hidden">
        ←
      </span>
    </button>
    <For each={props.groups}>
      {(group) => (
        <Show when={group.rows.length > 0}>
          <section
            data-testid="works-rail-group"
            data-group={group.key}
            class="min-w-0"
          >
            <h3 class="m-0 mb-1 hidden px-2 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-fg-3 conductor-md:block">
              {group.name}
            </h3>
            <For each={group.rows}>
              {(row) => <Line id={row[0]} row={row} />}
            </For>
          </section>
        </Show>
      )}
    </For>
  </nav>
);

export default WorkRail;
