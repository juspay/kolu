/**
 * One-time migration: move user preferences from localStorage to server conf.
 *
 * Reads localStorage keys used by the old makePersisted-based modules,
 * sends any non-default values to the server, then removes the keys.
 * Idempotent — if no keys exist, does nothing.
 */

import type { UserPreferencesUpdate, ColorScheme } from "kolu-common";

const LOCAL_KEYS = [
  "kolu-color-scheme",
  "kolu-random-theme",
  "kolu-scroll-lock",
  "kolu-activity-alerts",
  "kolu-startup-tips",
  "kolu-seen-tips",
] as const;

/** Build a partial update from any localStorage values still present. Returns null if nothing to migrate. */
export function collectLocalPreferences(): UserPreferencesUpdate | null {
  const patch: UserPreferencesUpdate = {};
  let found = false;

  const cs = localStorage.getItem("kolu-color-scheme");
  if (cs && (cs === "light" || cs === "dark" || cs === "system")) {
    patch.colorScheme = cs as ColorScheme;
    found = true;
  }

  const rt = localStorage.getItem("kolu-random-theme");
  if (rt !== null) {
    patch.randomTheme = rt !== "false";
    found = true;
  }

  const sl = localStorage.getItem("kolu-scroll-lock");
  if (sl !== null) {
    patch.scrollLock = sl !== "false";
    found = true;
  }

  const aa = localStorage.getItem("kolu-activity-alerts");
  if (aa !== null) {
    patch.activityAlerts = aa !== "false";
    found = true;
  }

  const st = localStorage.getItem("kolu-startup-tips");
  if (st !== null) {
    patch.startupTips = st !== "false";
    found = true;
  }

  const seen = localStorage.getItem("kolu-seen-tips");
  if (seen) {
    try {
      const arr = JSON.parse(seen);
      if (Array.isArray(arr)) {
        patch.seenTips = arr.filter((s): s is string => typeof s === "string");
        found = true;
      }
    } catch {
      // Corrupt — skip
    }
  }

  return found ? patch : null;
}

/** Remove all old localStorage preference keys. */
export function clearLocalPreferences(): void {
  for (const key of LOCAL_KEYS) {
    localStorage.removeItem(key);
  }
}
