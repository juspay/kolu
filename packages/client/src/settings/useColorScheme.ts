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

// Lazily-initialised on first `useColorScheme()` call. Module-level so the
// .dark class effect runs once across all consumers (singleton — see
// solidjs.md "State per domain"). Once non-null it stays non-null.
let sharedIsDark: (() => boolean) | null = null;

export function useColorScheme() {
  const { preferences, updatePreferences } = usePreferences();
  const colorScheme = () => preferences().colorScheme;
  const setColorScheme = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  // First consumer initialises the shared memo + side-effect; subsequent
  // consumers reuse them.
  const isDarkMemo = sharedIsDark ?? initSharedIsDark(colorScheme);

  const isDark = () => isDarkMemo();
  /** Resolved scheme as a string literal, for libraries that accept
   *  `"dark" | "light"` (e.g. Pierre's `themeType`). */
  const themeTypeLiteral = (): "light" | "dark" =>
    isDarkMemo() ? "dark" : "light";
  return { colorScheme, setColorScheme, isDark, themeTypeLiteral } as const;
}

function initSharedIsDark(colorScheme: () => ColorScheme): () => boolean {
  const prefersDark = usePrefersDark();
  const memo = createMemo(() => {
    const scheme = colorScheme();
    return scheme === "dark" || (scheme === "system" && prefersDark());
  });
  createEffect(() => {
    const dark = memo();
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  });
  sharedIsDark = memo;
  return memo;
}
