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

let initialized = false;
let colorSchemeAccessor: () => ColorScheme;
let colorSchemeSetter: (scheme: ColorScheme) => void;

function init() {
  if (initialized) return;
  initialized = true;

  const { preferences, updatePreferences } = useServerState();
  colorSchemeAccessor = () => preferences().colorScheme;
  colorSchemeSetter = (scheme: ColorScheme) =>
    updatePreferences({ colorScheme: scheme });

  const prefersDark = usePrefersDark();

  createEffect(() => {
    const scheme = colorSchemeAccessor();
    const dark = scheme === "dark" || (scheme === "system" && prefersDark());
    document.documentElement.classList.toggle("dark", dark);
  });
}

export function useColorScheme() {
  init();
  return {
    colorScheme: colorSchemeAccessor!,
    setColorScheme: colorSchemeSetter!,
  } as const;
}
