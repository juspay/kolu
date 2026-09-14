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
 *      follows the terminal, #959.)
 *    - `dockOrder` — the user's drag arrangement of dock sections and their
 *      branch clusters, persisted PER HOST (`kolu-dockOrder:<host>`) exactly like
 *      the two filters above. Eviction rides the same seam as the sibling prefs:
 *      `perHostPref` sweeps the key when the host's created scope DISPOSES —
 *      which means a host removed cold (pooled but never activated this
 *      session) leaves an orphaned key behind. Accepted, and no different from
 *      the sibling prefs: an orphan is a few KB of dead names, where the
 *      REAL leak would be a set of knobs reappearing where the user didn't
 *      put them. Moving eviction to the membership seam (`hosts.remove`)
 *      would close it; that is a seam redesign all three prefs would share,
 *      not a per-arrangement fix.
 *
 *      Keying the arrangement by NAMES (repo + branch label) rather than ids has
 *      two known edges, both intended:
 *        (a) two clones sharing a repo name already share one dock section today,
 *            so they share one stored slot — the arrangement cannot tell them apart;
 *        (b) a branch rename or re-checkout produces a NEW label that appends at
 *            the bottom of its repo — the pinned position of the OLD name is gone
 *            with it, exactly as if the old terminal had been closed. */

import type { DockOrder } from "../canvas/dock/dockTree";
import type { HostKey } from "kolu-common/hostKey";
import type { Accessor, Setter } from "solid-js";
import {
  perHostBoolPref,
  perHostName,
  perHostPref,
  parseTolerantList,
  readWithFallback,
} from "../persistedPref";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  isActivityWindow,
} from "../terminal/activityWindow";

/** Storage key base for the per-host activity-window pref — the ONE spelling
 *  (createHostPrefs + fleet index reader share this). */
export const ACTIVITY_WINDOW_PREF_BASE = "kolu-activityWindow";

/** The storage key base for the per-host dock-arrangement pref — the ONE
 *  spelling (createHostPrefs + any stored-order reader share this). */
export const DOCK_ORDER_PREF_BASE = "kolu-dockOrder";

/** Accept a stored dock-order node: a `{ repo, labels }` pair with deduped
 *  labels, or `undefined` so the tolerant-array parse drops one bad node without
 *  throwing away the user's whole arrangement. */
function acceptDockOrderNode(item: unknown): DockOrder[number] | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const { repo, labels } = item as { repo?: unknown; labels?: unknown };
  if (typeof repo !== "string" || repo.length === 0) return undefined;
  if (!Array.isArray(labels)) return undefined;
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const l of labels) {
    if (typeof l !== "string") continue;
    if (seen.has(l)) continue;
    seen.add(l);
    deduped.push(l);
  }
  return { repo, labels: deduped };
}

function parseActivityWindow(raw: string): ActivityWindow {
  if (isActivityWindow(raw)) return raw;
  throw new Error(`unrecognized activity window: ${raw}`);
}

/** Non-reactive read of a host's persisted activity window — for membership-
 *  scoped consumers that must not wait for HostScope birth (fleet switcher).
 *  Key composition via {@link perHostName}; parse via {@link readWithFallback}. */
export function readStoredActivityWindow(host: HostKey): ActivityWindow {
  const name = perHostName(ACTIVITY_WINDOW_PREF_BASE, host);
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
  return readWithFallback(
    raw,
    parseActivityWindow,
    DEFAULT_ACTIVITY_WINDOW,
    (err, offending) =>
      console.warn(
        `[activityWindow] ignoring invalid stored value for "${name}": ${JSON.stringify(offending)} — falling back to ${JSON.stringify(DEFAULT_ACTIVITY_WINDOW)}`,
        err,
      ),
  );
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
  /** The user's drag arrangement of dock sections and their branch clusters —
   *  persisted per host under `kolu-dockOrder:<encoded host>`, the same device-
   *  local, host-keyed policy as the two filters above. Empty means "pure
   *  structural order" (nothing ever dragged). */
  dockOrder: Accessor<DockOrder>;
  setDockOrder: Setter<DockOrder>;
}

/** Accept one stored `{ repo, labels }` node of the user's dock arrangement and
 *  tighten it. Runs inside {@link parseDockOrder}'s tolerant loop, so a bad node
 *  is dropped, never allowed to eat the whole order. */
function parseDockOrder(raw: string): DockOrder {
  return parseTolerantList(
    raw,
    "dockOrder",
    acceptDockOrderNode,
    (n) => n.repo,
    200,
  );
}

export function createHostPrefs(host: HostKey): HostPrefs {
  // Dock filters + arrangement: persisted PER HOST — a dock filter is a sticky
  // preference (it must survive reload), but keyed by host so two hosts don't
  // share one filter. `perHostPref`/`perHostBoolPref` own the `<base>:<host>`
  // key composition + the evict-on-host-exit cleanup (see their docstrings);
  // this factory just names each base.
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
  const [dockOrder, setDockOrder] = perHostPref<DockOrder>({
    host,
    base: DOCK_ORDER_PREF_BASE,
    fallback: [],
    parse: parseDockOrder,
  });

  return {
    activityWindow,
    setActivityWindow,
    showSleeping,
    setShowSleeping,
    dockOrder,
    setDockOrder,
  };
}
