/**
 * An update landing on a host — `ready` → `ready` with ANOTHER bundle of the
 * SAME profile (`updateLanded`) — as the one Solid effect that watches its
 * status cell.
 *
 * Compares each status's PLAIN facts (`landedFacts`: profile and bundle,
 * copied out as strings), never the status value: a cell's value is reconciled
 * in place into one store object (`@kolu/surface`'s `writeWrappedValue`), so
 * the value read before and after a landing is the same proxy, and a watcher
 * keyed on it never sees the edge. `watchLanding.test.ts` drives it through a
 * real reconciled store.
 */

import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import {
  type LandedFacts,
  landedFacts,
  updateLanded,
} from "@kolu/agent-distro/status";
import { createEffect } from "solid-js";

/** Run `onLanded` with the newly landed bundle each time an update lands. */
export function watchLanding(
  read: () => AgentDistroStatus | undefined,
  onLanded: (bundle: string) => void,
): void {
  let prev: LandedFacts | undefined;
  createEffect(() => {
    const now = landedFacts(read());
    const landed = updateLanded(prev, now);
    prev = now;
    if (landed && now !== undefined) onLanded(now.bundle);
  });
}
