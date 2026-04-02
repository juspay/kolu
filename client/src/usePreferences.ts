/**
 * User preferences — persisted to server-side conf via background sync.
 *
 * Module-level signals with makePersisted provide synchronous reactivity
 * identical to the pre-server-sync behavior. Server sync runs in the
 * background: fetch on init, persist on every change.
 */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import type { UserPreferences, UserPreferencesUpdate } from "kolu-common";

// --- Module-level signals (localStorage for backwards-compat startup timing) ---

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

// --- Server sync (background, non-blocking) ---

import { client } from "./rpc";

/** Persist partial update to server. */
function persist(patch: UserPreferencesUpdate) {
  client.preferences.set(patch).catch(() => {});
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

function seenTips(): string[] {
  try {
    return JSON.parse(seenTipsJson());
  } catch {
    return [];
  }
}

export { seenTips };

export function markTipSeen(id: string) {
  const s = new Set(seenTips());
  if (s.has(id)) return;
  s.add(id);
  const arr = [...s];
  setSeenTipsJson(JSON.stringify(arr));
  persist({ seenTips: arr });
}
