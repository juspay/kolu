import { Key } from "@solid-primitives/keyed";
import { finished, inProgress, type WorkRow } from "kolu-work";
import { type Component, createEffect, createMemo, Show } from "solid-js";
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

const Cards: Component<{ rows: ReadonlyArray<WorkRow> }> = (props) => (
  <div class="flex flex-col gap-2">
    <Key each={props.rows} by={([id]) => id}>
      {(row) => <WorkCard id={row()[0]} work={row()[1]} />}
    </Key>
  </div>
);

type Placement = "inline" | "side";

const columnClass = (placement: Placement): string =>
  `min-w-0 px-3 py-2 ${placement === "inline" ? "border-t border-edge bg-surface-1" : "bg-surface-0"}`;

const WorkColumn: Component<{
  placement: Placement;
}> = (props) => {
  const works = useWorks();
  const needs = useNeedsYou();
  const live = createMemo(() => inProgress(works()));
  const groups = createMemo(() => {
    const waiting = new Set(needs().map((one) => one.work));
    const onYou: WorkRow[] = [];
    const moving: WorkRow[] = [];
    for (const row of live()) (waiting.has(row[0]) ? onYou : moving).push(row);
    return { onYou, moving };
  });
  const done = createMemo(() => finished(works()));
  createEffect(() => {
    const want = wantedCard();
    if (want !== null && done().some(([id]) => id === want.id)) openFinished();
  });

  return (
    <div
      data-testid="work-column"
      data-placement={props.placement}
      class={columnClass(props.placement)}
    >
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
