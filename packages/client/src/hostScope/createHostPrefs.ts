import type { DockOrder } from "../terminal/dockOrder";
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

export const ACTIVITY_WINDOW_PREF_BASE = "kolu-activityWindow";

export const DOCK_ORDER_PREF_BASE = "kolu-dockOrder";

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
    if (deduped.length >= 200) break;
  }
  return { repo, labels: deduped };
}

function parseActivityWindow(raw: string): ActivityWindow {
  if (isActivityWindow(raw)) return raw;
  throw new Error(`unrecognized activity window: ${raw}`);
}

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
  activityWindow: Accessor<ActivityWindow>;
  setActivityWindow: Setter<ActivityWindow>;
  showSleeping: Accessor<boolean>;
  setShowSleeping: Setter<boolean>;
  dockOrder: Accessor<DockOrder>;
  setDockOrder: Setter<DockOrder>;
}

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
