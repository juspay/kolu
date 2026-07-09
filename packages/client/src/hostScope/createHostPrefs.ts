/** `createHostPrefs` — ONE host's STICKY per-host PREFERENCES, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  A sibling owner member to `createViewState` (selection + posture),
 *  `createCamera`, and `createSessionRestore`. It holds the three sticky
 *  preferences that are a VIEW OF this host's content — so per-host by THE RULE
 *  (see `canvas/canvasBoundaryGuard.test.ts`) — but that, UNLIKE the selection
 *  state in `createViewState`, a close-all `reset()` must NOT clear: they are
 *  preferences, not selection. Splitting them out of `createViewState` is exactly
 *  what lets that factory's `reset()` clear its WHOLE state with no "clear these,
 *  but not the prefs" allow/deny list to keep in sync.
 *
 *    - `activityWindow` / `showSleeping` — the two dock filters. Persisted PER
 *      HOST (`kolu-activityWindow:<host>` / `kolu-showSleeping:<host>`) so a
 *      sticky filter survives reload without two hosts colliding on one global key.
 *    - `rightPanelCollapsed` — this host's right-panel collapsed bit. In-memory;
 *      `undefined` means "inherit the global preference" (the `useRightPanel`
 *      facade seeds the read), a set value is this host's override (reload
 *      re-inherits the global, matching the camera/posture tier). */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { type Accessor, createSignal, onCleanup, type Setter } from "solid-js";
import { boolPref, persistedPref } from "../persistedPref";
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
  /** This host's right-panel collapsed bit — `undefined` means "inherit the
   *  global preference" (the seed the facade reads on first sight); a set value
   *  is this host's in-memory override (reload re-inherits the global). */
  rightPanelCollapsed: Accessor<boolean | undefined>;
  setRightPanelCollapsed: Setter<boolean | undefined>;
}

export function createHostPrefs(host: HostKey): HostPrefs {
  // The per-host storage-key suffix — the map's `codec.encode(host)`, computed
  // once per owner. A per-host pref's key is `<base>:<host>`, appended HERE in
  // one place (`perHostKey`) so a sticky pref cannot be spelled without its host
  // scope — the "remember to append `:${encoded}`" hazard dies at the seam.
  const encoded = encodeHostKey(host);
  const perHostKey = (base: string): string => `${base}:${encoded}`;

  // Dock filters: persisted PER HOST — a dock filter is a sticky preference (it
  // must survive reload), but keyed by host so two hosts don't share one filter.
  const [activityWindow, setActivityWindow] = persistedPref<ActivityWindow>({
    name: perHostKey("kolu-activityWindow"),
    fallback: DEFAULT_ACTIVITY_WINDOW,
    parse: (raw) => {
      if (isActivityWindow(raw)) return raw;
      throw new Error(`unrecognized activity window: ${raw}`);
    },
  });
  const [showSleeping, setShowSleeping] = boolPref({
    name: perHostKey("kolu-showSleeping"),
    fallback: true,
  });

  // Right-panel collapsed: in-memory per host. `undefined` = inherit the global
  // preference — the `useRightPanel` facade seeds the read with
  // `preferences().rightPanel.collapsed`, so a host's first sight matches the old
  // global bit and only diverges once the user toggles it on THAT host.
  const [rightPanelCollapsed, setRightPanelCollapsed] = createSignal<
    boolean | undefined
  >(undefined);

  // EVICT this host's persisted filters when it leaves the pool. `scopedByEntry`'s
  // `keyArray` disposes this owner the instant the host leaves `padiMap.entries`
  // (a `hosts.remove`), firing this cleanup. Without it, every distinct HostKey a
  // tab ever activated — including kolu's ephemeral remote boxes with unique names
  // (`pu` / remote-host-testing) — would leave two orphaned `localStorage` keys
  // FOREVER (unbounded growth). A page RELOAD does NOT run this (the browser kills
  // the process, not a Solid dispose), so the sticky-across-reload contract holds;
  // only an actual host removal evicts. (`rightPanelCollapsed` is in-memory — no
  // key to evict.)
  onCleanup(() => {
    localStorage.removeItem(perHostKey("kolu-activityWindow"));
    localStorage.removeItem(perHostKey("kolu-showSleeping"));
  });

  return {
    activityWindow,
    setActivityWindow,
    showSleeping,
    setShowSleeping,
    rightPanelCollapsed,
    setRightPanelCollapsed,
  };
}
