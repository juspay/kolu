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

import { PrPip } from "@kolu/solid-dockrow";
import { identityColor, recencyText } from "@kolu/solid-dockrow/rowValues";
import { NeedsYouCapsule } from "@kolu/solid-statepip";
import { Key } from "@solid-primitives/keyed";
import { Option } from "effect";
import type { Work, WorkId, WorkRow } from "kolu-work";
import {
  type Component,
  createMemo,
  createSignal,
  onMount,
  Show,
} from "solid-js";
import RepoMonogram from "../ui/RepoMonogram";
import { resizableWidth } from "../ui/resizableWidth";
import { useShownClock } from "../ui/shown";
import { createWidthDrag, WidthResizeHandle } from "../ui/WidthResizeHandle";
import MemberMarks from "./MemberMarks";
import { createWorkFacts } from "./workFacts";
import { standingClock } from "./WorkStanding";
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
  /** HOW LONG IT HAS STOOD WHERE IT IS: while it waits on you, the Dock's
   *  violet capsule with the bare duration ("6m"); otherwise the card's own
   *  clock (`standingClock`), so the two say one thing in one way. */
  const since = createMemo(() =>
    at().who === "you"
      ? {
          wait: true,
          text: recencyText("wait-chip", Date.parse(at().since), now()),
        }
      : { wait: false, text: standingClock(at(), now()) },
  );
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
      title={`${props.work.title} — ${standing()} · ${since().text}`}
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
            <Show
              when={since().wait}
              fallback={
                <span
                  data-testid="works-rail-since"
                  class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
                >
                  {since().text}
                </span>
              }
            >
              <NeedsYouCapsule
                testid="works-rail-wait"
                title="How long this work has waited on you"
              >
                {since().text}
              </NeedsYouCapsule>
            </Show>
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
 *  an entry keyed by the row would be built again on each one. A group with
 *  no works draws nothing. */
const Group: Component<{
  /** The overview group it mirrors, as data: `waiting`, `in-progress`,
   *  `watching` or `finished`. */
  group: string;
  name: string;
  rows: ReadonlyArray<WorkRow>;
  /** Finished folds, on the overview's switch. */
  folds?: boolean;
}> = (props) => (
  <Show when={props.rows.length > 0}>
    <section
      data-testid="works-rail-group"
      data-group={props.group}
      class="min-w-0"
    >
      <Show
        when={props.folds}
        fallback={
          <h3 class="m-0 mb-1 hidden px-2 font-mono text-[0.55rem] uppercase tracking-[0.12em] text-fg-3 conductor-md:block">
            {props.name} · {props.rows.length}
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
            {props.name} · {props.rows.length}
          </span>
        </button>
      </Show>
      <Show when={!props.folds || isFinishedOpen()}>
        <Key each={props.rows} by={([id]) => id}>
          {(row) => <Line id={row()[0]} work={row()[1]} />}
        </Key>
      </Show>
    </section>
  </Show>
);

/** THE SIDEBAR'S FOUR GROUPS, the overview's own: four fixed places, each
 *  handed its rows. Fixed, not a list of group objects: the groups are minted
 *  afresh whenever any work changes, and a list keyed by them would take down
 *  every group — and every entry in it — on each change. */
export interface RailGroups {
  readonly waiting: ReadonlyArray<WorkRow>;
  readonly moving: ReadonlyArray<WorkRow>;
  readonly watching: ReadonlyArray<WorkRow>;
  readonly finished: ReadonlyArray<WorkRow>;
}

const WorkRail: Component<{ groups: RailGroups }> = (props) => {
  // The host the sidebar shares with the works beside it: its own parent,
  // read once it is in the page (a `ref` runs before it is inserted).
  let nav!: HTMLElement;
  const [host, setHost] = createSignal<HTMLElement | null>(null);
  onMount(() => setHost(nav.parentElement));
  const resize = createWidthDrag(SIDEBAR_WIDTH, host);
  return (
    <nav
      ref={nav}
      data-testid="works-rail"
      aria-label="Works"
      style={{ "--rail-width": `${resize.rendered()}px` }}
      class="relative flex min-h-0 w-14 shrink-0 flex-col border-e border-edge conductor-md:w-[var(--rail-width)]"
    >
      {/* THE TOP ROW: one box of one fixed height in both views, so nothing
          under it moves between all the works and one. With a work open it
          is the way back; on home it names where you are, not pressed. In
          the strip of initials it keeps its height and says nothing on
          home. */}
      <div class="mx-1.5 mt-3 flex h-7 shrink-0 items-center">
        <Show
          when={pickedWork() !== null}
          fallback={
            <span class="hidden px-2 text-[0.72rem] font-semibold text-fg-3 conductor-md:inline">
              All work
            </span>
          }
        >
          <button
            type="button"
            data-testid="works-all"
            aria-label="All work"
            class="h-full w-full cursor-pointer rounded-md px-2 text-start text-[0.72rem] font-semibold text-accent hover:bg-surface-2"
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
      </div>
      {/* PINNED: what needs you never scrolls away. Its own scroll only when
          it alone would fill the sidebar. */}
      <Show when={props.groups.waiting.length > 0}>
        <div
          data-testid="works-rail-pinned"
          class="max-h-[50%] shrink-0 overflow-y-auto border-b border-edge px-1.5 py-3"
        >
          <Group group="waiting" name="Needs you" rows={props.groups.waiting} />
        </div>
      </Show>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden px-1.5 py-3">
        <Group
          group="in-progress"
          name="In progress"
          rows={props.groups.moving}
        />
        <Group group="watching" name="Watching" rows={props.groups.watching} />
        <Group
          group="finished"
          name="Finished"
          rows={props.groups.finished}
          folds
        />
      </div>
      <div class="hidden conductor-md:contents">
        <WidthResizeHandle drag={resize} testId="works-rail-resize-handle" />
      </div>
    </nav>
  );
};

export default WorkRail;
