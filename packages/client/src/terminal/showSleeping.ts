/** Whether the dock shows sleeping (☾) terminals — a per-device toggle
 *  that sits alongside the activity-window filter. The two are orthogonal
 *  filters over the same dock:
 *
 *    - the activity window hides terminals by *staleness* (a slept tile
 *      whose sleep is older than the window routes to `parked` and drops),
 *    - this toggle hides terminals by *deliberate dormancy* — the fresh,
 *      still-in-window `sleeping` rows the window keeps.
 *
 *  Default `true`: sleeping terminals show (the existing behaviour). When
 *  the user flips it off, `buildDockTree` drops `sleeping`-bucket rows the
 *  same way it drops `parked` rows, surfacing a count so the footer stays
 *  reachable to toggle them back. Persisted PER HOST under
 *  `kolu-showSleeping:<host>` so the choice survives reloads, exactly like
 *  `activityWindow` — a sibling per-host dock filter (W7 TIER A). */

import { activeScope } from "../hostScope/hostScopes";

/** Whether the ACTIVE host's dock shows sleeping (☾) rows — a per-host fact born
 *  in the host scope's `createHostPrefs` (persisted per host so each host keeps
 *  its own ☾ filter across a switch and a reload). Read here through the facade;
 *  floors the removal race to `true` (the permissive default). */
export function showSleeping(): boolean {
  return activeScope()?.prefs.showSleeping() ?? true;
}

/** Toggle/set the ACTIVE host's ☾ filter (a no-op during the removal race).
 *  Accepts the updater form the dock footer's toggle uses (`(prev) => !prev`). */
export function setShowSleeping(
  next: boolean | ((prev: boolean) => boolean),
): void {
  activeScope()?.prefs.setShowSleeping(next);
}
