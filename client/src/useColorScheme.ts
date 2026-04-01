/**
 * Color scheme DOM effect — toggles `.dark` on <html> based on server-backed preferences.
 *
 * Call once from the app root. The effect tracks the `colorScheme` preference reactively.
 * Re-exports ColorScheme type from common for convenience.
 */

import { createEffect } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import { usePreferences } from "./usePreferences";

export type { ColorScheme } from "kolu-common";

let initialized = false;

/** Initialize the color scheme DOM effect. Idempotent — safe to call multiple times. */
export function useColorScheme() {
  if (initialized) return;
  initialized = true;

  const { colorScheme } = usePreferences();
  const prefersDark = usePrefersDark();

  createEffect(() => {
    const dark =
      colorScheme() === "dark" || (colorScheme() === "system" && prefersDark());
    document.documentElement.classList.toggle("dark", dark);
  });
}
