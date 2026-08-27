/** The dock's recency CLOCKS — the one place a row's `now` is read.
 *
 *  `@kolu/solid-dockrow` owns which rendering a row gets (`recencyMode`), which
 *  timestamp that rendering means (`displayRecencyAt`), WHAT IT SAYS
 *  (`recencyText`), the violet capsule and the reserved 8ch track. What it
 *  deliberately does not own is the CLOCK: a ticking `now` is ambient app state,
 *  and kolu runs two of them on purpose — a 1 s tick for the wait chip, whose
 *  sub-minute seconds must count up, and a plain `Date.now()` read for "3m ago",
 *  which recomputes on mount because the 60 s ceiling on its visual lag is
 *  invisible.
 *
 *  The words used to be here too, and that is what this file lost: three
 *  sentences a consumer rendering the same row could not reach, so the first one
 *  to try re-spelled them and diverged in both modes. Now the fold is the
 *  package's and only the two clocks are kolu's — which is all this file ever
 *  had that was actually the app's.
 *
 *  It stays ONE binding for all three row surfaces (`DockRow`, `DockListRow`,
 *  the needs-you strip), because each used to spell `displayRecencyAt(…)` itself
 *  and hand the cell a raw timestamp. */

import type { RowRecency } from "@kolu/solid-dockrow";
import {
  displayRecencyAt,
  recencyMode,
  recencyText,
} from "@kolu/solid-dockrow/rowValues";
import { getClockNow } from "../../time/clock";

/** Build the row-recency reader. Call from a component body: the returned
 *  function reads the shared 1 s clock in the wait-chip arm, so a long-blocked
 *  agent's capsule counts up without a repaint hook, and reads nothing at all
 *  in the other two arms. */
export function useRowRecency(): (
  pip: { asking: boolean; active: boolean },
  /** The tile's window recency — newest activity across parent and splits. */
  windowRecencyAt: number | null,
  /** THIS row's own agent recency — how long it has awaited you. */
  ownRecencyAt: number | null,
) => RowRecency {
  const tick = getClockNow();
  return (pip, windowRecencyAt, ownRecencyAt) => {
    const mode = recencyMode(pip);
    // No filler: `hidden` has no text, and the union does not let one be
    // spelled. That the old shape REQUIRED a `text: ""` here was the evidence
    // the product type was wrong.
    if (mode === "hidden") return { mode };
    const at = displayRecencyAt(mode, windowRecencyAt, ownRecencyAt);
    // THE TWO-CLOCK SEAM, stated once. `Date.now()` is not reactive, so the
    // `ago` arm subscribes to nothing — and neither does a wait chip with no
    // honest duration to show, which is why `at !== null` is part of the test
    // rather than left to `recencyText`: a never-active blocked row would
    // otherwise re-render every second to repaint the same dash.
    const now = mode === "wait-chip" && at !== null ? tick() : Date.now();
    return { mode, text: recencyText(mode, at, now) };
  };
}
