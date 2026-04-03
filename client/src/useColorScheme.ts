/**
 * UI color scheme (dark/light) — reads from server state.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createEffect } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import type { ColorScheme } from "kolu-common";
import { useServerState } from "./useServerState";

export type { ColorScheme };

let effectInitialized = false;

export function useColorScheme() {
  const { preferences, updatePreferences } = useServerState();
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  // Toggle .dark class — only set up once (first consumer wins)
  if (!effectInitialized) {
    effectInitialized = true;
    const prefersDark = usePrefersDark();
    createEffect(() => {
      const scheme = colorScheme();
      const dark = scheme === "dark" || (scheme === "system" && prefersDark());
      document.documentElement.classList.toggle("dark", dark);
    });
  }

  return { colorScheme, setColorScheme } as const;
}
