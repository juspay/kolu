/**
 * User preferences — server-side persistence via conf.
 *
 * Module-level makePersisted signals provide synchronous startup defaults.
 * Every preference change is persisted to the server. On first settings open,
 * server values are fetched and applied (replacing localStorage values).
 */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import type { UserPreferences, UserPreferencesUpdate } from "kolu-common";

// --- Signals (localStorage for synchronous startup, server replaces on first sync) ---

const [randomTheme, setRandomTheme] = makePersisted(createSignal(true), {
  name: "kolu-random-theme",
  serialize: String,
  deserialize: (s) => s !== "false",
});

const [scrollLock, setScrollLock] = makePersisted(createSignal(true), {
  name: "kolu-scroll-lock",
  serialize: String,
  deserialize: (s) => s !== "false",
});

const [activityAlerts, setActivityAlerts] = makePersisted(createSignal(true), {
  name: "kolu-activity-alerts",
  serialize: String,
  deserialize: (s) => s !== "false",
});

const [startupTips, setStartupTips] = makePersisted(createSignal(true), {
  name: "kolu-startup-tips",
});

const [seenTipsJson, setSeenTipsJson] = makePersisted(createSignal("[]"), {
  name: "kolu-seen-tips",
});

const [colorScheme, setColorScheme] = makePersisted(
  createSignal<"light" | "dark" | "system">("dark"),
  { name: "kolu-color-scheme" },
);

/** Apply server preferences to all signals (replaces localStorage values). */
function applyPrefs(prefs: UserPreferences) {
  setRandomTheme(prefs.randomTheme);
  setScrollLock(prefs.scrollLock);
  setActivityAlerts(prefs.activityAlerts);
  setStartupTips(prefs.startupTips);
  setSeenTipsJson(JSON.stringify(prefs.seenTips));
  setColorScheme(prefs.colorScheme);
}

// --- Server sync via HTTP ---

const RPC_BASE = `${window.location.origin}/rpc`;

async function rpcGet(): Promise<UserPreferences> {
  const res = await fetch(`${RPC_BASE}/preferences/get`, { method: "POST" });
  return (await res.json()) as UserPreferences;
}

async function rpcSet(patch: UserPreferencesUpdate): Promise<void> {
  await fetch(`${RPC_BASE}/preferences/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

let synced = false;
let dirty = false;

/** Fetch preferences from server. Call on first settings open. Idempotent. */
export function initPreferences() {
  if (synced) return;
  synced = true;
  rpcGet()
    .then((prefs) => {
      if (!dirty) applyPrefs(prefs);
    })
    .catch(() => {});
}

/** Persist partial update to server. */
function persist(patch: UserPreferencesUpdate) {
  dirty = true;
  rpcSet(patch).catch(() => {});
}

// --- Public API ---

export function usePreferences() {
  return {
    randomTheme,
    setRandomTheme: (v: boolean) => {
      setRandomTheme(v);
      persist({ randomTheme: v });
    },
    scrollLock,
    setScrollLock: (v: boolean) => {
      setScrollLock(v);
      persist({ scrollLock: v });
    },
    activityAlerts,
    setActivityAlerts: (v: boolean) => {
      setActivityAlerts(v);
      persist({ activityAlerts: v });
    },
  } as const;
}

export { colorScheme, startupTips };

export function setColorSchemePref(v: "light" | "dark" | "system") {
  setColorScheme(v);
  persist({ colorScheme: v });
}

export function setStartupTipsPref(v: boolean) {
  setStartupTips(v);
  persist({ startupTips: v });
}

function getSeenTips(): string[] {
  try {
    return JSON.parse(seenTipsJson());
  } catch {
    return [];
  }
}
export { getSeenTips as seenTips };

export function markTipSeen(id: string) {
  const s = new Set(getSeenTips());
  if (s.has(id)) return;
  s.add(id);
  const arr = [...s];
  setSeenTipsJson(JSON.stringify(arr));
  persist({ seenTips: arr });
}
