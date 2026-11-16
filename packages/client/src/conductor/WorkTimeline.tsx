/** AN OPEN CARD'S TIMELINE — one stage of it, until the whole is asked for.
 *
 *  A card stays short however long its work runs: the timeline shows the
 *  events of ONE stage (the stage the work is in, or the one pressed on the
 *  strip, which is the timeline's index), and "whole timeline · N events"
 *  unfolds all of it in place and folds it back. Which stage an event is in is
 *  `kolu-work`'s own filing (`Stages`' `events`, from the walk that files the
 *  time), never a rule of this face's. A watch has no stages, so its card
 *  shows its latest few events instead (`timelineShown`).
 *
 *  EACH ROW IS ONE LINE: its time, who it was by, its words, and how long that
 *  step took. Words longer than the line are cut, with a "more" beside them
 *  rather than the row becoming a button — so the PR number a row names is a
 *  link whether the row was cut or not. A `Wrote …` row opens its file. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { type Stages, took, type Work, type WorkId } from "kolu-work";
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
  isWholeTimeline,
  pressedStage,
  toggleWholeTimeline,
} from "./workListing";
import {
  clockOf,
  EVENT_INK,
  eventReader,
  mergeReason,
  oneLine,
  STAGE_LABEL,
  timelineShown,
  WATCH_EVENTS_SHOWN,
} from "./workReadings";

const WorkTimeline: Component<{
  id: WorkId;
  work: Work;
  stages: Stages;
  /** The clock a running step is measured to. */
  now: number;
}> = (props) => {
  /** Which rows have their whole words out. Dies with the card. */
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<number>>(new Set());
  const toggleRow = (index: number): void => {
    setUnfolded((was) => {
      const next = new Set(was);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  };

  const shown = createMemo(() =>
    timelineShown(
      props.work,
      props.stages,
      pressedStage(props.id),
      isWholeTimeline(props.id),
    ),
  );
  /** THE TIMELINE'S WORDS, built once per move of the record rather than per
   *  row: the two facts a row needs about the WHOLE timeline (which commits
   *  its check events name, which decision an ask points at) are computed
   *  once by the reader this returns. */
  const words = createMemo(() => eventReader(props.work));
  const steps = createMemo(() =>
    took(props.work, new Date(props.now).toISOString()),
  );
  const heading = (): string => {
    const view = shown().view;
    switch (view.kind) {
      case "stage":
        return STAGE_LABEL[view.stage];
      case "latest":
        return "latest";
      case "whole":
        return "whole";
      default:
        return view satisfies never;
    }
  };
  /** The control's words: what a press does from here — unfold the whole,
   *  or fold back to the part the card shows when folded. */
  const unfold = (): string => {
    if (shown().view.kind !== "whole")
      return `whole timeline · ${props.work.events.length} events`;
    const folded = timelineShown(
      props.work,
      props.stages,
      pressedStage(props.id),
      false,
    ).view;
    return folded.kind === "stage"
      ? `only ${STAGE_LABEL[folded.stage]}`
      : `latest ${WATCH_EVENTS_SHOWN}`;
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
        Timeline · {heading()}
      </h4>
      <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
        <For each={shown().indices}>
          {(index) => {
            const event = () => props.work.events[index];
            return (
              <Show when={event()}>
                {(one) => {
                  const whole = () => words()(one());
                  const cut = () => oneLine(whole());
                  const open = () => unfolded().has(index);
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
                      <span class="w-9 shrink-0 whitespace-nowrap font-mono text-[0.6rem] tabular-nums text-fg-3">
                        {clockOf(one().at)}
                      </span>
                      <span
                        aria-hidden="true"
                        class={`h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full ${EVENT_INK[one().by]}`}
                      />
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
                                onClick={() => toggleRow(index)}
                              >
                                {open() ? "less" : "more"}
                              </button>
                            </Show>
                          </>
                        }
                      >
                        {/* A FILE THE WORK WROTE OPENS FROM ITS ROW — the
                            event names the work and the path, so there is
                            nothing to match; a link only where the reader can
                            open it (for a work that ended, a kept copy). */}
                        <Match
                          when={(() => {
                            const it = one();
                            return it.kind === "file" &&
                              holdsPath(props.work, it.path)
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
                      {/* HOW LONG THAT STEP TOOK — the step still running
                          keeps counting, with the ellipsis that says so. */}
                      <span class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3">
                        <Show when={steps()[index]}>
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
          }}
        </For>
      </ul>
      <Show
        when={
          shown().view.kind === "whole" ||
          shown().indices.length < props.work.events.length
        }
      >
        <button
          type="button"
          data-testid="work-timeline-whole"
          aria-expanded={shown().view.kind === "whole"}
          class="mt-1 cursor-pointer text-[0.66rem] text-accent hover:underline"
          onClick={() => toggleWholeTimeline(props.id)}
        >
          {unfold()}
        </button>
      </Show>
    </section>
  );
};

export default WorkTimeline;
