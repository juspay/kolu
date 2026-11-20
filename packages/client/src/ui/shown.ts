/** Whether anybody is looking at this retained view — the right panel's tabs
 *  and the Conductor pane stay mounted when hidden, so every consumer of work
 *  or of input reads this accessor rather than the DOM. */

import { type Accessor, createContext, createMemo, useContext } from "solid-js";
import { getClockNow } from "../time/clock";

export const Shown = createContext<Accessor<boolean>>();

/** Whether the retained view this is drawn in is the one being looked at.
 *  Throws where no provider stands. */
export function useShown(): Accessor<boolean> {
  const shown = useContext(Shown);
  if (!shown)
    throw new Error("A view that asks shown() must be drawn inside Shown");
  return shown;
}

/** The app's one 1 s clock (`time/clock.ts`), stopped while the view is
 *  hidden: while `shown()` is false this memo never reads `now()`, so it holds
 *  no subscription to the tick and freezes at the last on-screen value. */
export function useShownClock(): Accessor<number> {
  const shown = useShown();
  const now = getClockNow();
  return createMemo((previous: number) => (shown() ? now() : previous), now());
}
