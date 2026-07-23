/** The shared per-host attention MARKS store — the bridge from the single
 *  `useAttention` owner (which computes them cross-host) to the host chips (which
 *  render them), without prop-drilling through the whole tree.
 *
 *  It is the ONE store for every host-tab attention mark. Each host carries the
 *  full derived fact:
 *    • `asking` — agents blocked on your input (the violet needs-you pill);
 *    • `unseenFinished` — terminals that FINISHED a turn while you weren't looking
 *      and you haven't visited the host since (the quiet host-tab dot). It is NOT
 *      "has any finished agent" (a finished agent idles in `waiting` ~forever, so
 *      that would light every host permanently); it accrues only on a fresh
 *      background finish and clears the moment you switch to the host;
 *    • `live` — whether the host's link + urgency cell are up (a dead host's held
 *      `asking` must not inflate the app badge).
 *
 *  `useAttention` writes `asking` + `live` from each per-host root and the engine
 *  writes `unseenFinished`; both go through `writeHostMarks`, which shallow-MERGES
 *  so the two writers don't clobber each other. A module-level singleton store
 *  (created once) so a chip reads it reactively. */

import { createStore, produce } from "solid-js/store";

export interface HostMarks {
  /** Agents blocked on your input — the violet needs-you pill, hidden at zero. */
  asking: number;
  /** Finished-but-unvisited terminals on this host — the quiet host-tab dot. */
  unseenFinished: number;
  /** Host link + urgency cell are up — a dead host's `asking` must not count. */
  live: boolean;
}

const [marks, setMarks] = createStore<Record<string, HostMarks>>({});

/** Merge (or clear, with `undefined`) a host's marks — called by `useAttention`
 *  (asking + live) and the engine (unseenFinished). A partial object shallow-MERGES
 *  into the host's record so the two writers don't clobber each other's fields.
 *  Clearing DELETES the key (not sets it to `undefined`), so the singleton store
 *  can't grow unbounded across host add/remove churn. */
export function writeHostMarks(
  encHost: string,
  value: Partial<HostMarks> | undefined,
): void {
  if (value === undefined) {
    setMarks(produce((m) => delete m[encHost]));
    return;
  }
  setMarks(encHost, value);
}

/** A host's asking count as a reactive read — the violet needs-you pill fodder. */
export function hostAsking(encHost: string): number {
  return marks[encHost]?.asking ?? 0;
}

/** A host's unseen-finished count as a reactive read — the chip's dot fodder. */
export function hostUnseenFinished(encHost: string): number {
  return marks[encHost]?.unseenFinished ?? 0;
}

/** Both of a host's chip marks as reactive accessors in one call — the violet
 *  needs-you pill and the quiet amber unseen-finished dot — so a chip reads them
 *  from ONE place (desktop chip, narrow switcher row, mobile chip). */
export function hostMarks(encHost: string): {
  asking: () => number;
  unseenFinished: () => number;
} {
  return {
    asking: () => hostAsking(encHost),
    unseenFinished: () => hostUnseenFinished(encHost),
  };
}

/** The app-badge fold: Σ `asking` over LIVE hosts — read reactively inside the
 *  badge effect. A dead host's held count never inflates it. */
export function liveAskingTotal(): number {
  let count = 0;
  for (const enc of Object.keys(marks)) {
    const m = marks[enc];
    if (m?.live) count += m.asking;
  }
  return count;
}
