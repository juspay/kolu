/**
 * UI color scheme (dark/light) — reads from server-backed preferences.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Re-exports ColorScheme type from common for convenience.
 */

import { createEffect } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import { usePreferences } from "./usePreferences";

export type { ColorScheme } from "kolu-common";

let initialized = false;

export function useColorScheme() {
  const { colorScheme, setColorScheme } = usePreferences();

  if (!initialized) {
    initialized = true;
    const prefersDark = usePrefersDark();
    createEffect(() => {
      const dark =
        colorScheme() === "dark" ||
        (colorScheme() === "system" && prefersDark());
      document.documentElement.classList.toggle("dark", dark);
    });
  }

  return { colorScheme, setColorScheme } as const;
}
