/** IS ANYBODY LOOKING AT THIS VIEW? — one fact, passed down every retained
 *  host in the app.
 *
 *  Two subtrees are MOUNTED ONCE and RETAINED rather than unmounted when you
 *  look elsewhere: the right panel's tabs (an inactive tab keeps its tree) and
 *  the Conductor pane (switching to a host tab hides it — an out-of-flow host
 *  with `content-visibility: hidden`, `App.tsx`). Retention is what makes the
 *  trip back free: the watched panel stays open, each Look stays open, the
 *  folds stay as they were, the transcript stays where it was scrolled, a
 *  half-typed message is still in the box, and the Code tab's queries are
 *  still leased. Nothing has to be hoisted out to survive the switch, because
 *  the subtree itself survives it.
 *
 *  A retained view that keeps WORKING while nobody can see it is the price
 *  that would make this a bad trade — Look would keep reading a machine's
 *  screen every two seconds, the second hand would keep re-rendering, and the
 *  pane's `Escape` would keep leaving a mode the reader is not in. So every
 *  consumer of work or of input asks THIS accessor, and no consumer asks the
 *  DOM: an element's size, an `IntersectionObserver` or the pressed target
 *  answer about layout, which is a different question and one that is wrong
 *  for exactly the frames that matter (`/solidjs`, "Own work and visibility").
 *
 *  ONE context for both hosts, not one per host. The question is the same
 *  question, and the components that ask it are drawn in both places — the
 *  Conductor's watched panel and the inspector's sections live in different
 *  trees today and a shared one tomorrow. A component that had to know WHICH
 *  retained host it was in would be a component that cannot be moved. */

import { type Accessor, createContext, createMemo, useContext } from "solid-js";
import { getClockNow } from "../time/clock";

export const Shown = createContext<Accessor<boolean>>();

/** Whether the retained view this is drawn in is the one being looked at.
 *  Throws where no provider stands: a view that reads this outside a retained
 *  host is a bug to be told about, not a view to guess visible. */
export function useShown(): Accessor<boolean> {
  const shown = useContext(Shown);
  if (!shown)
    throw new Error("A view that asks shown() must be drawn inside Shown");
  return shown;
}

/** The app's one 1 s clock (`time/clock.ts`), STOPPED while the view is
 *  hidden — the Conductor's elapsed on the status line, the strip's ages, a
 *  running tool card's timer and the watched rows' durations all read this
 *  rather than the clock itself.
 *
 *  A memo and not an `if` at each call site: while `shown()` is false the body
 *  never reads `now()`, so this memo holds no subscription to the tick at all
 *  and the whole hidden subtree is silent for it. The frozen value is the last
 *  one that was on screen, which is what the first frame after coming back
 *  draws for the instant before the memo re-reads the clock. */
export function useShownClock(): Accessor<number> {
  const shown = useShown();
  const now = getClockNow();
  return createMemo((previous: number) => (shown() ? now() : previous), now());
}
