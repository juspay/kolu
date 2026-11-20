import { Key } from "@solid-primitives/keyed";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { took, type Work, type WorkEvent, type WorkId } from "kolu-work";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { holdsPath } from "./namedFiles";
import PrText from "./PrText";
import { openReader, readerTarget } from "./reader/useReader";
import {
  rowKey,
  type TimelineRow,
  type TimelineShown,
  type TimelineView,
  WATCH_EVENTS_SHOWN,
} from "./timelineView";
import { mergeReason } from "./prReadings";
import {
  clockOf,
  EVENT_INK,
  eventReader,
  folderRowWords,
  oneLine,
  STAGE_LABEL,
} from "./workReadings";

const viewWord = (view: TimelineView): string => {
  switch (view.kind) {
    case "stage":
      return STAGE_LABEL[view.stage];
    case "latest":
      return `latest ${WATCH_EVENTS_SHOWN}`;
    case "whole":
      return "whole";
    default:
      return view satisfies never;
  }
};

const RowStamp: Component<{ at: string; by: WorkEvent["by"] }> = (props) => (
  <>
    <span class="w-9 shrink-0 whitespace-nowrap font-mono text-[0.6rem] tabular-nums text-fg-3">
      {clockOf(props.at)}
    </span>
    <span
      aria-hidden="true"
      class={`h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full ${EVENT_INK[props.by]}`}
    />
  </>
);

const WorkTimeline: Component<{
  id: WorkId;
  work: Work;
  shown: TimelineShown;
  onWhole: () => void;
  now: number;
}> = (props) => {
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void => {
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const shown = () => props.shown;
  const words = createMemo(() => eventReader(props.work));
  const steps = createMemo(() =>
    took(props.work, new Date(props.now).toISOString()),
  );
  const unfold = (): string => {
    if (shown().view.kind !== "whole")
      return `whole timeline · ${shown().total} events`;
    const folded = shown().folded;
    return folded.kind === "stage"
      ? `only ${viewWord(folded)}`
      : viewWord(folded);
  };

  const EventRow: Component<{ index: number }> = (row) => {
    const event = () => props.work.events[row.index];
    return (
      <Show when={event()}>
        {(one) => {
          const whole = () => words()(one());
          const cut = () => oneLine(whole());
          const key = () => rowKey({ kind: "event", index: row.index });
          const open = () => opened().has(key());
          return (
            <li
              data-testid="work-event"
              data-kind={one().kind}
              data-by={one().by}
              data-merge={(() => {
                const it = one();
                return it.kind === "merge-state"
                  ? mergeReason(it.merge)
                  : undefined;
              })()}
              data-draft={(() => {
                const it = one();
                return it.kind === "draft-state" ? it.draft : undefined;
              })()}
              class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem]"
            >
              <RowStamp at={one().at} by={one().by} />
              <Switch
                fallback={
                  <>
                    <span
                      class={`min-w-0 flex-1 text-fg-2 ${open() ? "whitespace-pre-wrap break-words" : "truncate"}`}
                    >
                      <PrText
                        work={props.work}
                        text={open() ? whole() : cut().line}
                      />
                    </span>
                    <Show when={cut().rest}>
                      <button
                        type="button"
                        data-testid="work-event-more"
                        aria-expanded={open()}
                        class="shrink-0 cursor-pointer rounded-sm px-1 font-mono text-[0.58rem] text-accent hover:underline"
                        onClick={() => toggle(key())}
                      >
                        {open() ? "less" : "more"}
                      </button>
                    </Show>
                  </>
                }
              >
                <Match
                  when={(() => {
                    const it = one();
                    return it.kind === "file" && holdsPath(props.work, it.path)
                      ? it.path
                      : undefined;
                  })()}
                >
                  {(path) => {
                    const current = () => {
                      const target = readerTarget();
                      return (
                        target !== null &&
                        target.work === props.id &&
                        target.path === path()
                      );
                    };
                    return (
                      <button
                        type="button"
                        data-testid="work-event-file"
                        data-path={path()}
                        aria-label={`Open ${path()}`}
                        aria-current={current() ? "true" : undefined}
                        class={`min-w-0 flex-1 cursor-pointer truncate rounded-sm text-start hover:underline ${
                          current() ? "text-accent" : "text-fg-2"
                        }`}
                        onClick={() =>
                          openReader({ work: props.id, path: path() })
                        }
                      >
                        {cut().line}
                      </button>
                    );
                  }}
                </Match>
              </Switch>
              <span class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3">
                <Show when={steps()[row.index]}>
                  {(step) =>
                    step().ms === 0 && !step().open
                      ? ""
                      : `${dualPhrase(step().ms)}${step().open ? "…" : ""}`
                  }
                </Show>
              </span>
            </li>
          );
        }}
      </Show>
    );
  };

  const FolderRow: Component<{
    row: Extract<TimelineRow, { kind: "folder" }>;
  }> = (folder) => {
    const event = () => props.work.events[folder.row.indices[0] ?? 0];
    const open = () => opened().has(rowKey(folder.row));
    return (
      <Show when={event()}>
        {(one) => (
          <li data-testid="work-event-folder" data-path={folder.row.folder}>
            <div class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem]">
              <RowStamp at={one().at} by={one().by} />
              <span class="min-w-0 flex-1 truncate text-fg-2">
                {folderRowWords(folder.row.folder, folder.row.indices.length)}
              </span>
              <button
                type="button"
                data-testid="work-event-more"
                aria-expanded={open()}
                class="shrink-0 cursor-pointer rounded-sm px-1 font-mono text-[0.58rem] text-accent hover:underline"
                onClick={() => toggle(rowKey(folder.row))}
              >
                {open() ? "less" : "more"}
              </button>
            </div>
            <Show when={open()}>
              <ul class="m-0 ml-4 flex list-none flex-col gap-0.5 border-l border-edge p-0 pl-2">
                <For each={folder.row.indices}>
                  {(index) => <EventRow index={index} />}
                </For>
              </ul>
            </Show>
          </li>
        )}
      </Show>
    );
  };

  return (
    <section
      data-testid="work-timeline"
      data-view={shown().view.kind}
      data-stage={(() => {
        const view = shown().view;
        return view.kind === "stage" ? view.stage : undefined;
      })()}
      class="mt-2.5"
    >
      <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
        Timeline · {viewWord(shown().view)}
      </h4>
      <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
        <Key each={shown().rows} by={rowKey}>
          {(row) => (
            <Switch>
              <Match
                when={(() => {
                  const it = row();
                  return it.kind === "event" ? it : undefined;
                })()}
              >
                {(it) => <EventRow index={it().index} />}
              </Match>
              <Match
                when={(() => {
                  const it = row();
                  return it.kind === "folder" ? it : undefined;
                })()}
              >
                {(it) => <FolderRow row={it()} />}
              </Match>
            </Switch>
          )}
        </Key>
      </ul>
      <Show
        when={
          shown().view.kind === "whole" || shown().rows.length < shown().total
        }
      >
        <button
          type="button"
          data-testid="work-timeline-whole"
          aria-expanded={shown().view.kind === "whole"}
          class="mt-1 cursor-pointer text-[0.66rem] text-accent hover:underline"
          onClick={() => props.onWhole()}
        >
          {unfold()}
        </button>
      </Show>
    </section>
  );
};

export default WorkTimeline;
