/** The shared per-host attention MARKS store — the bridge from the single
 *  `useAttention` owner (which computes them cross-host) to the host chips (which
 *  render them), without prop-drilling through the whole tree.
 *
 *  Today it carries one mark: `unseenFinished` — the count of terminals on a host
 *  that FINISHED a turn while you weren't looking and you haven't visited the host
 *  since. It is NOT "has any finished agent" (a finished agent idles in `waiting`
 *  ~forever, so that would light every host permanently); it accrues only on a
 *  fresh background finish and clears the moment you switch to the host. A
 *  module-level singleton store (created once) so a chip reads it reactively. */

import { createStore } from "solid-js/store";

export interface HostMarks {
  /** Finished-but-unvisited terminals on this host — the quiet host-tab dot. */
  unseenFinished: number;
}

const [marks, setMarks] = createStore<Record<string, HostMarks>>({});

/** Write (or clear, with `undefined`) a host's marks — called by `useAttention`. */
export function writeHostMarks(
  encHost: string,
  value: HostMarks | undefined,
): void {
  setMarks(encHost, value as HostMarks);
}

/** A host's unseen-finished count as a reactive read — the chip's dot fodder. */
export function hostUnseenFinished(encHost: string): number {
  return marks[encHost]?.unseenFinished ?? 0;
}
