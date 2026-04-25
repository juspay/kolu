/**
 * UI color scheme (dark/light) — reads from server state.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in,
 * and mirrors the choice into the `color-scheme` CSS property so third-party
 * shadow-DOM widgets (e.g. `@pierre/trees`, `@pierre/diffs`) that use
 * `light-dark()` or form-control theming follow the same resolved scheme.
 * Defaults to "dark" (the app's original palette).
 */

import { usePrefersDark } from "@solid-primitives/media";
import type { ColorScheme } from "kolu-common";
import { createEffect, createMemo } from "solid-js";
import { usePreferences } from "./usePreferences";

export type { ColorScheme };

let effectInitialized = false;
let sharedIsDark: (() => boolean) | null = null;

export function useColorScheme() {
  const { preferences, updatePreferences } = usePreferences();
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  // Toggle .dark class — only set up once (first consumer wins)
  if (!effectInitialized) {
    effectInitialized = true;
    const prefersDark = usePrefersDark();
    sharedIsDark = createMemo(() => {
      const scheme = colorScheme();
      return scheme === "dark" || (scheme === "system" && prefersDark());
    });
    createEffect(() => {
      const dark = sharedIsDark!();
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    });
  }

  const isDark = () => sharedIsDark!();
  /** Resolved scheme as a string literal, for libraries that accept
   *  `"dark" | "light"` (e.g. Pierre's `themeType`). */
  const themeTypeLiteral = (): "light" | "dark" =>
    sharedIsDark!() ? "dark" : "light";
  return { colorScheme, setColorScheme, isDark, themeTypeLiteral } as const;
}
