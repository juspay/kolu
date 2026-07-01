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

import { persistedPref } from "../persistedPref";

/** Per-device choice: show sleeping terminals in the dock, or hide them.
 *  Singleton — one persisted store the dock footer's ☾ toggle writes and
 *  `useDockOrder` reads. */
export const [showSleeping, setShowSleeping] = persistedPref<boolean>({
  name: "kolu-show-sleeping",
  fallback: true,
  // `persistedPref`'s default serialize writes the literal "true"/"false"
  // (see persistedPref.ts) — so parse must accept exactly those, never a
  // `Boolean(raw)` truthiness check that reads the stored "false" as true.
  parse: (raw) => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`unrecognized show-sleeping pref: ${raw}`);
  },
});
