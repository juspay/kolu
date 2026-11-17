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
 *  needs to wake when it moves. The bell asks only after the page has drawn
 *  and measured a new item (`useAttention`), so a question that arrives in
 *  view has said so by then. */

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

const inView = new Map<string, number>();

/** What a work's card is known by here. */
export const cardOnScreenKey = (work: string): string => `card:${work}`;
/** What a question is known by here — its ask, wherever it is drawn. */
export const askOnScreenKey = (ask: string): string => `ask:${ask}`;

/** Is anything known by this key in view right now? */
export const isOnScreen = (key: string): boolean => (inView.get(key) ?? 0) > 0;

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
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setIntersecting(entry.isIntersecting);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
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
