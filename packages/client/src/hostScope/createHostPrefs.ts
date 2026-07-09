/** `createHostPrefs` — ONE host's STICKY per-host PREFERENCES, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  A sibling owner member to `createViewState` (selection + posture),
 *  `createCamera`, and `createSessionRestore`. It holds the two sticky dock filters
 *  that are a VIEW OF this host's content — so per-host by THE RULE (see
 *  `canvas/canvasBoundaryGuard.test.ts`) — but that, UNLIKE the selection state in
 *  `createViewState`, a close-all `reset()` must NOT clear: they are preferences,
 *  not selection. Splitting them out of `createViewState` is exactly what lets that
 *  factory's `reset()` clear its WHOLE state with no "clear these, but not the
 *  prefs" allow/deny list to keep in sync.
 *
 *    - `activityWindow` / `showSleeping` — the two dock filters. Persisted PER
 *      HOST (`kolu-activityWindow:<host>` / `kolu-showSleeping:<host>`) so a
 *      sticky filter survives reload without two hosts colliding on one global key.
 *      (The right-panel collapsed bit is NOT here — it's a global VIEWER-layout
 *      preference that must survive reload; a per-host in-memory bit broke that.) */

import type { HostKey } from "kolu-common/hostKey";
import type { Accessor, Setter } from "solid-js";
import { perHostBoolPref, perHostPref } from "../persistedPref";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  isActivityWindow,
} from "../terminal/activityWindow";

export interface HostPrefs {
  /** This host's dock activity-window filter — persisted per host under
   *  `kolu-activityWindow:<encoded host>` so a host's filter survives reload (a
   *  sticky dock preference, unlike the volatile camera/posture) without two
   *  hosts colliding on one global key. */
  activityWindow: Accessor<ActivityWindow>;
  setActivityWindow: Setter<ActivityWindow>;
  /** Whether THIS host's dock shows sleeping (☾) rows — persisted per host under
   *  `kolu-showSleeping:<encoded host>`, same rationale as `activityWindow`. */
  showSleeping: Accessor<boolean>;
  setShowSleeping: Setter<boolean>;
}

export function createHostPrefs(host: HostKey): HostPrefs {
  // Dock filters: persisted PER HOST — a dock filter is a sticky preference (it must
  // survive reload), but keyed by host so two hosts don't share one filter.
  // `perHostPref`/`perHostBoolPref` own the `<base>:<host>` key composition + the
  // evict-on-host-exit cleanup (see their docstrings); this factory just names each base.
  const [activityWindow, setActivityWindow] = perHostPref<ActivityWindow>({
    host,
    base: "kolu-activityWindow",
    fallback: DEFAULT_ACTIVITY_WINDOW,
    parse: (raw) => {
      if (isActivityWindow(raw)) return raw;
      throw new Error(`unrecognized activity window: ${raw}`);
    },
  });
  const [showSleeping, setShowSleeping] = perHostBoolPref({
    host,
    base: "kolu-showSleeping",
    fallback: true,
  });

  return {
    activityWindow,
    setActivityWindow,
    showSleeping,
    setShowSleeping,
  };
}
