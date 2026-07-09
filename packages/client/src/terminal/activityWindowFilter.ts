/** Per-host activity-window FILTER facade — the ACTIVE host's dock activity-window
 *  choice, read/written through the host scope. Sibling of `showSleeping.ts`.
 *
 *  Kept OUT of the pure vocabulary leaf (`activityWindow.ts`, the `ActivityWindow`
 *  type + `WINDOWS` ladder + `isActivityWindow`/`windowOption`/idle-bucketing) so
 *  that least-volatile leaf has NO back-edge into the most-volatile per-host owner:
 *  `createHostPrefs` imports only the vocab leaf, this facade imports the vocab leaf
 *  plus `activeScope` — layering stays downward, no import cycle. */

import { activeScope } from "../hostScope/hostScopes";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  windowOption,
} from "./activityWindow";

/** The ACTIVE host's activity-window choice — a per-host fact born in the host
 *  scope's `createHostPrefs` (persisted per host under `kolu-activityWindow:<host>`),
 *  read here through the facade. W7 TIER A moved this OUT of one global localStorage
 *  singleton: switching hosts now shows each host's own dock filter, and the choice
 *  parameterizes a VIEW OF that host's terminals (per-host by THE RULE). Floors the
 *  removal race to the default, exactly as `useViewState` floors its per-host reads. */
export function activityWindow(): ActivityWindow {
  return activeScope()?.prefs.activityWindow() ?? DEFAULT_ACTIVITY_WINDOW;
}

/** Set the ACTIVE host's activity window (a no-op during the one-tick removal
 *  race, when there is no active scope to write). */
export function setActivityWindow(next: ActivityWindow): void {
  activeScope()?.prefs.setActivityWindow(next);
}

/** Reactive threshold (ms) for the currently-selected activity window.
 *  `null` when the user picked `"all"` — staleness is disabled. */
export function activityWindowThresholdMs(): number | null {
  return windowOption(activityWindow()).thresholdMs;
}
