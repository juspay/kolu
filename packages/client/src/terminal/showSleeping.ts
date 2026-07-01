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
 *  reachable to toggle them back. Localstorage-backed via `persistedPref`
 *  so the choice survives reloads, exactly like `activityWindow`. */

import { boolPref } from "../persistedPref";

/** Per-device choice: show sleeping terminals in the dock, or hide them.
 *  Singleton — one persisted store the dock footer's ☾ toggle writes and
 *  `useDockOrder` reads. `boolPref` carries the strict `"true"`/`"false"`
 *  parse so the stored `"false"` never reads back truthy. */
export const [showSleeping, setShowSleeping] = boolPref({
  name: "kolu-show-sleeping",
  fallback: true,
});
