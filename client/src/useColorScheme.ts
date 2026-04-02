/**
 * UI color scheme (dark/light) — server-backed via conf.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createEffect } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import { colorScheme, setColorSchemePref } from "./usePreferences";

export type { ColorScheme } from "kolu-common";

let initialized = false;

export function useColorScheme() {
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

  return {
    colorScheme,
    setColorScheme: setColorSchemePref,
  } as const;
}
