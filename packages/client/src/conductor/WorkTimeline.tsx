/** AN OPEN CARD'S TIMELINE — one stage of it, until the whole is asked for.
 *
 *  A card stays short however long its work runs: the timeline shows the
 *  events of ONE stage (the stage the work is in, or the one pressed on the
 *  strip, which is the timeline's index), and "whole timeline · N events"
 *  unfolds all of it in place and folds it back. Which part is shown is the
 *  card's one reading (`./timelineView.ts`), handed in, so the strip and this
 *  never disagree. A watch has no stages, so its card shows its latest few
 *  events instead.
 *
 *  EACH ROW IS ONE LINE: its time, who it was by, its words, and how long that
 *  step took. Words longer than the line are cut, with a "more" beside them
 *  rather than the row becoming a button — so the PR number a row names is a
 *  link whether the row was cut or not. A `Wrote …` row opens its file. A run
 *  of files one terminal wrote into one folder is ONE row (`Wrote mockup/ ·
 *  49 files`), whose "more" unfolds the per-file rows. */

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

/** A view's name, as the heading and the fold-back control say it. */
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

/** A ROW'S TIME AND WHO IT WAS BY — the clock cell and the coloured dot,
 *  drawn the same at the head of an event row and of a folder row. */
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
  /** What the card shows of the timeline, read once by the card. */
  shown: TimelineShown;
  /** Unfold the whole timeline, or fold it back. */
  onWhole: () => void;
  /** The clock a running step is measured to. */
  now: number;
}> = (props) => {
  /** Which rows are open — a cut row's whole words, or a folder row's file
   *  rows — by {@link rowKey}, which no two rows share. Dies with the card. */
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (key: string): void => {
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const shown = () => props.shown;
  /** THE TIMELINE'S WORDS, built once per move of the record rather than per
   *  row: the two facts a row needs about the WHOLE timeline (which commits
   *  its check events name, which decision an ask points at) are computed
   *  once by the reader this returns. */
  const words = createMemo(() => eventReader(props.work));
  const steps = createMemo(() =>
    took(props.work, new Date(props.now).toISOString()),
  );
  /** The control's words: what a press does from here — unfold the whole,
   *  or fold back to the part the card shows when folded. */
  const unfold = (): string => {
    if (shown().view.kind !== "whole")
      return `whole timeline · ${shown().total} events`;
    const folded = shown().folded;
    return folded.kind === "stage"
      ? `only ${viewWord(folded)}`
      : viewWord(folded);
  };

  /** ONE EVENT'S ROW — drawn the same at the top level and inside an
   *  unfolded folder row. */
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
                {/* A FILE THE WORK WROTE OPENS FROM ITS ROW — the event names
                    the work and the path, so there is nothing to match; a link
                    only where the reader can open it (for a work that ended, a
                    kept copy). */}
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
              {/* HOW LONG THAT STEP TOOK — the step still running keeps
                  counting, with the ellipsis that says so. */}
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

  /** ONE FOLDER'S ROW — the run of files one terminal wrote into one folder,
   *  said once, with its own more/less to unfold the per-file rows. */
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
        {/* KEYED, not `<For>`: the view is read again on every tick of the
            clock and mints fresh row objects, so a `<For>` over them would
            rebuild every row each time. */}
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
