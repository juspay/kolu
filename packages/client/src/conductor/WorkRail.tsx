/** THE SIDEBAR — every work, one entry each, beside the overview and beside a
 *  picked work alike, grouped as the overview is, so a person can see what
 *  every work is doing and jump between them without going back.
 *
 *  IT STAYS IN PLACE AND SCROLLS BY ITSELF. The works that need you are pinned
 *  at its top, each with how long it has waited, and the other groups scroll
 *  under them. Each group's heading counts its works; Finished folds, on the
 *  same switch the overview's Finished list uses.
 *
 *  A WORK'S ENTRY is two lines: the repository's monogram, the title and how
 *  long the work has stood where it is — the Dock's violet wait chip while it
 *  waits on you; then the Dock's status mark for each of its terminals (three
 *  at most, then "+N"), its PR pip, and where it stands in words. Every part
 *  is read by the same readings the work's card reads (`createWorkFacts`).
 *
 *  WIDE, IT IS RESIZED BY DRAGGING ITS RIGHT EDGE — the Dock's own drag
 *  (`ui/WidthResizeHandle.tsx`), with this sidebar's own stored width and
 *  bounds. Below 1280px it is a fixed strip of initials, each chip ringed
 *  while its work needs you, with the title, the standing and the time in its
 *  tooltip.
 *
 *  An entry is a way to a work, not the work: it carries no `work-card` test
 *  id and no `data-work`, which belong to the work's card alone. */

import { PrPip, RecencyCell, type RowRecency } from "@kolu/solid-dockrow";
import { identityColor, recencyText } from "@kolu/solid-dockrow/rowValues";
import { Key } from "@solid-primitives/keyed";
import { Option } from "effect";
import type { Work, WorkId, WorkRow } from "kolu-work";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import RepoMonogram from "../ui/RepoMonogram";
import { resizableWidth } from "../ui/resizableWidth";
import { useShownClock } from "../ui/shown";
import { createWidthDrag, WidthResizeHandle } from "../ui/WidthResizeHandle";
import MemberMarks from "./MemberMarks";
import { createWorkFacts } from "./workFacts";
import {
  isFinishedOpen,
  isPicked,
  pickedWork,
  pickWork,
  toggleFinished,
  unpickWork,
} from "./workListing";
import { WAITER_INK, WORK_DOT, workWhere } from "./workReadings";

/** The sidebar's own width, remembered per device. */
const SIDEBAR_WIDTH = resizableWidth("kolu-conductor-sidebar-width", {
  // The width the sidebar had before it could be resized.
  defaultPx: 240,
  // A title, its time and three marks stay legible.
  minPx: 192,
  maxPx: 448,
  // Room kept for the works beside it.
  reservePx: 560,
});

/** A work's initials — its first two words' first letters. */
function initialsOf(title: string): string {
  const words = title.split(/\s+/).filter((one) => one !== "");
  return words
    .slice(0, 2)
    .map((one) => one.charAt(0).toUpperCase())
    .join("");
}

const Line: Component<{ id: WorkId; work: Work }> = (props) => {
  const now = useShownClock();
  const { members, livePr, at } = createWorkFacts(
    () => props.id,
    () => props.work,
  );
  const where = () => {
    const one = workWhere(props.work);
    return one.kind === "branch" && one.repo !== "" ? one : undefined;
  };
  /** HOW LONG IT HAS STOOD WHERE IT IS, in the Dock's own words: the violet
   *  chip's bare duration while it waits on you ("6m"), an age otherwise
   *  ("4m ago"). A memo: the cell reads it in several tracking contexts. */
  const recency = createMemo((): Extract<RowRecency, { text: string }> => {
    const since = Date.parse(at().since);
    return at().who === "you"
      ? { mode: "wait-chip", text: recencyText("wait-chip", since, now()) }
      : { mode: "ago", text: recencyText("ago", since, now()) };
  });
  /** Where it stands, in words: the lead, then what is wanted. */
  const standing = () => [at().lead, ...Option.toArray(at().what)].join(" · ");
  const ink = () => {
    const who = at().who;
    return who === "done" ? "text-fg-2" : WAITER_INK[who].text;
  };
  return (
    <div
      data-testid="works-rail-line"
      data-rail-work={props.id}
      data-who={at().who}
      aria-current={isPicked(props.id) ? "true" : undefined}
      title={`${props.work.title} — ${standing()} · ${recency().text}`}
      class={`relative min-w-0 rounded-md ${
        isPicked(props.id) ? "bg-surface-2" : "hover:bg-surface-2"
      }`}
    >
      {/* The entry's press: a button laid under the text, so the PR pip on
          it is a link of its own. */}
      <button
        type="button"
        aria-label={props.work.title}
        class="absolute inset-0 cursor-pointer rounded-md"
        onClick={() => pickWork(props.id)}
      />
      <div class="pointer-events-none relative px-2 py-1">
        {/* WIDE: two lines. */}
        <div class="hidden min-w-0 flex-col gap-0.5 conductor-md:flex">
          <div class="flex min-w-0 items-center gap-1.5">
            <Show
              when={where()}
              fallback={
                <span
                  class={`mx-1 h-2 w-2 shrink-0 rounded-full ${WORK_DOT[at().who]}`}
                />
              }
            >
              {(branch) => (
                <RepoMonogram
                  group={branch().repo}
                  color={identityColor(branch().repo)}
                  size="xs"
                />
              )}
            </Show>
            <span
              data-testid="works-rail-title"
              class={`min-w-0 flex-1 truncate text-[0.72rem] ${
                isPicked(props.id) ? "font-semibold text-fg" : "text-fg-2"
              }`}
            >
              {props.work.title}
            </span>
            <RecencyCell recency={recency()} textSize="text-[0.6rem]" />
          </div>
          <div class="flex min-w-0 items-center gap-1">
            <MemberMarks members={members()} />
            <Show when={livePr()}>
              {(pr) => (
                <span class="pointer-events-auto relative flex">
                  <PrPip pr={pr()} />
                </span>
              )}
            </Show>
            <span
              data-testid="works-rail-standing"
              class={`min-w-0 truncate text-[0.64rem] ${ink()}`}
            >
              {standing()}
            </span>
          </div>
        </div>
        {/* NARROW: the initials, ringed while the work needs you. */}
        <span
          aria-hidden="true"
          class={`flex items-center justify-center gap-1 rounded-md py-0.5 font-mono text-[0.62rem] conductor-md:hidden ${
            at().who === "you" ? "ring-2 ring-alert" : ""
          }`}
        >
          <span
            class={`h-1.5 w-1.5 shrink-0 rounded-full ${WORK_DOT[at().who]}`}
          />
          {initialsOf(props.work.title)}
        </span>
      </div>
    </div>
  );
};

/** One group: its heading with its count, and its works, keyed by the work's
 *  id — the `works` cell mints a fresh row for every change of any work, and
 *  an entry keyed by the row would be built again on each one. */
const Group: Component<{
  group: {
    readonly key: string;
    readonly name: string;
    readonly rows: ReadonlyArray<WorkRow>;
  };
  /** Finished folds, on the overview's switch. */
  folds?: boolean;
}> = (props) => (
  <section
    data-testid="works-rail-group"
    data-group={props.group.key}
    class="min-w-0"
  >
    <Show
      when={props.folds}
      fallback={
        <h3 class="m-0 mb-1 hidden px-2 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-fg-3 conductor-md:block">
          {props.group.name} · {props.group.rows.length}
        </h3>
      }
    >
      <button
        type="button"
        data-testid="works-rail-finished-toggle"
        aria-expanded={isFinishedOpen()}
        class="mb-1 w-full cursor-pointer px-2 text-start font-mono text-[0.55rem] uppercase tracking-[0.12em] text-fg-3 hover:text-fg-2"
        onClick={toggleFinished}
      >
        {isFinishedOpen() ? "▾" : "▸"}
        <span class="hidden conductor-md:inline">
          {" "}
          {props.group.name} · {props.group.rows.length}
        </span>
      </button>
    </Show>
    <Show when={!props.folds || isFinishedOpen()}>
      <Key each={props.group.rows} by={([id]) => id}>
        {(row) => <Line id={row()[0]} work={row()[1]} />}
      </Key>
    </Show>
  </section>
);

const WorkRail: Component<{
  groups: ReadonlyArray<{
    /** The overview group it mirrors, as data: `waiting`, `in-progress`,
     *  `watching` or `finished`. */
    readonly key: string;
    readonly name: string;
    readonly rows: ReadonlyArray<WorkRow>;
  }>;
}> = (props) => {
  // The host the sidebar shares with the works beside it: its own parent,
  // read once it is in the page (a `ref` runs before it is inserted).
  let nav!: HTMLElement;
  const [host, setHost] = createSignal<HTMLElement | null>(null);
  onMount(() => setHost(nav.parentElement));
  const resize = createWidthDrag(SIDEBAR_WIDTH, host);
  const pinned = () => props.groups.filter((one) => one.key === "waiting");
  const rest = () => props.groups.filter((one) => one.key !== "waiting");
  return (
    <nav
      ref={nav}
      data-testid="works-rail"
      aria-label="Works"
      style={{ "--rail-width": `${resize.rendered()}px` }}
      class="relative flex min-h-0 w-14 shrink-0 flex-col border-e border-edge conductor-md:w-[var(--rail-width)]"
    >
      <Show when={pickedWork() !== null}>
        <button
          type="button"
          data-testid="works-all"
          aria-label="All work"
          class="mx-1.5 mt-3 cursor-pointer rounded-md px-2 py-1 text-start text-[0.72rem] font-semibold text-accent hover:bg-surface-2"
          onClick={() => unpickWork()}
        >
          <span aria-hidden="true" class="hidden conductor-md:inline">
            ← All work
          </span>
          <span aria-hidden="true" class="conductor-md:hidden">
            ←
          </span>
        </button>
      </Show>
      {/* PINNED: what needs you never scrolls away. Its own scroll only when
          it alone would fill the sidebar. */}
      <Show when={pinned().some((one) => one.rows.length > 0)}>
        <div
          data-testid="works-rail-pinned"
          class="max-h-[50%] shrink-0 overflow-y-auto border-b border-edge px-1.5 py-3"
        >
          <For each={pinned()}>{(group) => <Group group={group} />}</For>
        </div>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-1.5 py-3">
        <For each={rest()}>
          {(group) => (
            <Show when={group.rows.length > 0}>
              <Group group={group} folds={group.key === "finished"} />
            </Show>
          )}
        </For>
      </div>
      <div class="hidden conductor-md:contents">
        <WidthResizeHandle drag={resize} testId="works-rail-resize-handle" />
      </div>
    </nav>
  );
};

export default WorkRail;
