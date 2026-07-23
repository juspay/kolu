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
 *      (The right-panel collapsed bit is NOT here — it's finer-grained still: it
 *      travels with the TERMINAL via `TerminalMetadata.rightPanel`, so the panel
 *      follows the terminal, #959.) */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { Accessor, Setter } from "solid-js";
import { perHostBoolPref, perHostPref } from "../persistedPref";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  isActivityWindow,
} from "../terminal/activityWindow";

/** Storage key base for the per-host activity-window pref — the ONE spelling
 *  (createHostPrefs + fleet index reader share this). */
export const ACTIVITY_WINDOW_PREF_BASE = "kolu-activityWindow";

function parseActivityWindow(raw: string): ActivityWindow {
  if (isActivityWindow(raw)) return raw;
  throw new Error(`unrecognized activity window: ${raw}`);
}

/** Non-reactive read of a host's persisted activity window — for membership-
 *  scoped consumers that must not wait for HostScope birth (fleet switcher).
 *  Same key + parse as {@link createHostPrefs}; invalid/corrupt values warn
 *  and fall back to {@link DEFAULT_ACTIVITY_WINDOW}. */
export function readStoredActivityWindow(host: HostKey): ActivityWindow {
  const name = `${ACTIVITY_WINDOW_PREF_BASE}:${encodeHostKey(host)}`;
  let raw: string | null;
  try {
    raw = localStorage.getItem(name);
  } catch (err) {
    console.warn(
      `[activityWindow] storage unavailable for "${name}" — using default ${JSON.stringify(DEFAULT_ACTIVITY_WINDOW)}`,
      err,
    );
    return DEFAULT_ACTIVITY_WINDOW;
  }
  if (raw === null) return DEFAULT_ACTIVITY_WINDOW;
  try {
    return parseActivityWindow(raw);
  } catch (err) {
    console.warn(
      `[activityWindow] ignoring invalid stored value for "${name}": ${JSON.stringify(raw)} — falling back to ${JSON.stringify(DEFAULT_ACTIVITY_WINDOW)}`,
      err,
    );
    return DEFAULT_ACTIVITY_WINDOW;
  }
}

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
    base: ACTIVITY_WINDOW_PREF_BASE,
    fallback: DEFAULT_ACTIVITY_WINDOW,
    parse: parseActivityWindow,
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
