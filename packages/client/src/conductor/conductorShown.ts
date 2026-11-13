/** IS ANYBODY LOOKING AT THE CONVERSATION? — one fact, passed down the pane.
 *
 *  The pane is MOUNTED ONCE and RETAINED: switching to a host tab hides it
 *  (an out-of-flow host with `content-visibility: hidden`, `App.tsx`) instead
 *  of unmounting it, so the watched panel stays open, each Look stays open,
 *  the folds stay as they were, the transcript stays where it was scrolled and
 *  a half-typed message is still in the box when the tab comes back. Nothing
 *  has to be hoisted out of the pane to survive the trip, because the pane
 *  itself survives it.
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
 *  The twin of `right-panel/panelShown.ts`, deliberately separate: that one
 *  answers for the inspector's tabs, this one for the conversation, and one
 *  context serving both would make a provider's absence unreadable. */

import { type Accessor, createContext, createMemo, useContext } from "solid-js";
import { getClockNow } from "../time/clock";

export const ConductorShown = createContext<Accessor<boolean>>();

/** The pane's visibility, as every part of it reads the fact. Throws where no
 *  provider stands, like the panel's: a conductor view drawn outside the pane
 *  is a bug to be told about, not a view to guess visible. */
export function useConductorShown(): Accessor<boolean> {
  const shown = useContext(ConductorShown);
  if (!shown) throw new Error("Conductor view requires ConductorShown");
  return shown;
}

/** The app's one 1 s clock (`time/clock.ts`), STOPPED while the pane is
 *  hidden — the elapsed on the status line, the strip's ages, a running tool
 *  card's timer and the watched rows' "quiet for" all read this rather than
 *  the clock itself.
 *
 *  A memo and not an `if` at each call site: while `shown()` is false the body
 *  never reads `now()`, so this memo holds no subscription to the tick at all
 *  and the whole hidden subtree is silent for it. The frozen value is the last
 *  one that was on screen, which is what the first frame after coming back
 *  draws for the instant before the memo re-reads the clock. */
export function useShownClock(): Accessor<number> {
  const shown = useConductorShown();
  const now = getClockNow();
  return createMemo((previous: number) => (shown() ? now() : previous), now());
}
