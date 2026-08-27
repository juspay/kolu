/** The dock's two CLOCKS — the only part of a row's recency that is the app's.
 *
 *  `@kolu/solid-dockrow` owns the rest, and owns it as one call: which rendering
 *  a row gets, which timestamp that rendering means, what it says, which clock
 *  each arm reads, the violet capsule and the reserved 8ch track. This file used
 *  to hold the assembly — four lines with three invisible rules in them — and
 *  every consumer rendering the same row had to write those four lines too. The
 *  first one to try got two of the three wrong.
 *
 *  What is genuinely kolu's is that there are two clocks at all: a 1 s tick for
 *  the wait chip, whose sub-minute seconds must count up, and a plain
 *  `Date.now()` read for "3m ago", which recomputes on mount because the 60 s
 *  ceiling on its visual lag is invisible. A ticking `now` is ambient app state
 *  and its cadence is the app's call — so the package takes the two READERS and
 *  decides between them itself. */

import type { RecencyAt, RowRecency } from "@kolu/solid-dockrow/rowValues";
import { rowRecency } from "@kolu/solid-dockrow/rowValues";
import { getClockNow } from "../../time/clock";

/** Build the row-recency reader. Call from a component body: the returned
 *  function reads the shared 1 s clock only in the wait-chip arm — and only when
 *  that chip has an honest duration to count — so a quiet row subscribes to
 *  nothing. */
export function useRowRecency(): (
  pip: { asking: boolean; active: boolean },
  at: RecencyAt,
) => RowRecency {
  const counting = getClockNow();
  return (pip, at) => rowRecency(pip, at, { counting, glancing: Date.now });
}
