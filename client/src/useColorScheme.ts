/**
 * UI color scheme (dark/light) — server-backed via conf.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createEffect } from "solid-js";
import { usePrefersDark } from "@solid-primitives/media";
import { usePrefsQuery } from "./usePreferences";
import type { ColorScheme } from "kolu-common";

export type { ColorScheme } from "kolu-common";

export function useColorScheme() {
  const { query, update } = usePrefsQuery();

  const colorScheme = (): ColorScheme => query.data?.colorScheme ?? "dark";

  function setColorScheme(scheme: ColorScheme) {
    update({ colorScheme: scheme });
  }

  // Toggle .dark on <html> reactively
  const prefersDark = usePrefersDark();
  createEffect(() => {
    const dark =
      colorScheme() === "dark" || (colorScheme() === "system" && prefersDark());
    document.documentElement.classList.toggle("dark", dark);
  });

  return { colorScheme, setColorScheme } as const;
}
