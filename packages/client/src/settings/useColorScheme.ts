/**
 * UI color scheme (dark/light) — reads from server state.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createEffect, createMemo } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import type { ColorScheme, ThemeMode } from "kolu-common";
import { usePreferences } from "./usePreferences";

export type { ColorScheme };

let effectInitialized = false;

export function useColorScheme() {
  const { preferences, updatePreferences } = usePreferences();
  const prefersDark = usePrefersDark();
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });
  const resolvedColorScheme = createMemo<ThemeMode>(() => {
    const scheme = colorScheme();
    return scheme === "dark" || (scheme === "system" && prefersDark())
      ? "dark"
      : "light";
  });

  // Toggle .dark class — only set up once (first consumer wins)
  if (!effectInitialized) {
    effectInitialized = true;
    createEffect(() => {
      document.documentElement.classList.toggle(
        "dark",
        resolvedColorScheme() === "dark",
      );
    });
  }

  return { colorScheme, resolvedColorScheme, setColorScheme } as const;
}
