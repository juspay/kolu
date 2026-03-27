/**
 * UI color scheme (dark/light) — persisted singleton.
 *
 * Toggles `.dark` on <html> so CSS variable overrides in index.css kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createSignal, createEffect } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { usePrefersDark } from "@solid-primitives/media";

export type ColorScheme = "light" | "dark" | "system";

const [colorScheme, setColorScheme] = makePersisted(
  createSignal<ColorScheme>("dark"),
  { name: "kolu-color-scheme" },
);

let initialized = false;
function init() {
  if (initialized) return;
  initialized = true;

  const prefersDark = usePrefersDark();

  createEffect(() => {
    const dark =
      colorScheme() === "dark" || (colorScheme() === "system" && prefersDark());
    document.documentElement.classList.toggle("dark", dark);
  });
}

export function useColorScheme() {
  init();
  return { colorScheme, setColorScheme } as const;
}
