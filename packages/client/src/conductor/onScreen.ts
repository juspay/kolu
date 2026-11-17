/** WHAT IS ON SCREEN — which work cards and which questions a person can see
 *  right now, for the one rule that silences the bell: an item rings unless
 *  THAT item is in view in a focused window (`attention/conductorAsks.ts`).
 *
 *  Looking at the Conductor is not looking at everything in it: a column of
 *  five works scrolls, and a question asked about the one below the fold has
 *  not been seen. So a card and a question each say for themselves whether
 *  they are in view: an `IntersectionObserver` for the box, AND the retained
 *  pane's `shown()` — a pane hidden behind a host tab still has a laid-out
 *  box the observer would call visible (`ui/shown.ts`).
 *
 *  A count per key, not a flag: the same question is drawn on its card, in
 *  the chat and in the reader (`WorkQuestion` tracks itself wherever it is
 *  drawn), and any one of them in view is it in view. Plain module state,
 *  read at the instant the bell asks — nothing renders from it, so nothing
 *  needs to wake when it moves. WHEN that answer is in is this module's to
 *  say too: a box mounted now is in it only once its observer has reported
 *  ({@link afterViewKnown}). */

import type { NeedsYou } from "kolu-work";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const inView = new Map<string, number>();

/** Boxes being observed whose observer has not reported yet. Every observed
 *  box gets a first report of its own, in view or not, after the page has
 *  laid it out; until each has, what is in view is not known. */
let unmeasured = 0;
/** What is waiting for every box to have reported. */
const whenMeasured = new Set<() => void>();
const measuredOne = (): void => {
  unmeasured -= 1;
  if (unmeasured > 0) return;
  const waiting = [...whenMeasured];
  whenMeasured.clear();
  for (const run of waiting) run();
};

/** What a work's card is known by here. */
export const cardOnScreenKey = (work: string): string => `card:${work}`;
/** What a question is known by here — its ask, wherever it is drawn. */
export const askOnScreenKey = (ask: string): string => `ask:${ask}`;

/** IS THIS ITEM IN VIEW in a focused window — its question wherever it is
 *  drawn, or for a merge wait its card. Looking at the Conductor is not
 *  looking at the item, and an unfocused window is looking at nothing. */
export const isNeedInView = (item: NeedsYou): boolean =>
  document.hasFocus() &&
  (inView.get(
    item.why.why === "question"
      ? askOnScreenKey(item.why.ask)
      : cardOnScreenKey(item.work),
  ) ?? 0) > 0;

/** A caller that runs `decide` once the page can say what is in view: a frame
 *  on, by when anything mounted in this pass is being observed, and then as
 *  soon as every observed box has had its first report. Not a count of
 *  frames: how long an observer takes to report after layout is the
 *  browser's business. A window without focus has nothing in view to wait
 *  for (and a hidden one draws no frames), so it decides at once. Calls while
 *  one is waiting share it; the wait ends with the owner. */
export function afterViewKnown(decide: () => void): () => void {
  let waiting = false;
  let frame: number | undefined;
  const run = (): void => {
    waiting = false;
    decide();
  };
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    whenMeasured.delete(run);
  });
  return () => {
    if (waiting) return;
    if (!document.hasFocus()) {
      decide();
      return;
    }
    waiting = true;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (unmeasured === 0) run();
      else whenMeasured.add(run);
    });
  };
}

/** Count the element handed to the returned ref under `key`, for as long as
 *  it is in view and its pane is shown. Call from a component's body and pass
 *  the result as the element's `ref`: the element is observed from the
 *  moment it exists, and the count ends with the component. */
export function trackOnScreen(
  key: Accessor<string>,
  shown: Accessor<boolean>,
): (el: HTMLElement) => void {
  const [box, setBox] = createSignal<HTMLElement>();
  const [intersecting, setIntersecting] = createSignal(false);
  createEffect(() => {
    const el = box();
    if (el === undefined) return;
    let reported = false;
    const reportedOnce = (): void => {
      if (reported) return;
      reported = true;
      measuredOne();
    };
    unmeasured += 1;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setIntersecting(entry.isIntersecting);
      reportedOnce();
    });
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
      reportedOnce();
    });
  });
  createEffect(() => {
    if (!intersecting() || !shown()) return;
    const at = key();
    inView.set(at, (inView.get(at) ?? 0) + 1);
    onCleanup(() => {
      const left = (inView.get(at) ?? 1) - 1;
      if (left > 0) inView.set(at, left);
      else inView.delete(at);
    });
  });
  return setBox;
}
