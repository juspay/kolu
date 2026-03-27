/**
 * UI color scheme (dark/light) — persisted singleton.
 *
 * Applies `.dark` class to `<html>` so CSS variable overrides kick in.
 * Defaults to "dark" (the app's original palette).
 */

import { createSignal, createEffect, onCleanup } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

export type ColorScheme = "light" | "dark" | "system";

const STORAGE_KEY = "kolu-color-scheme";

const [colorScheme, setColorScheme] = makePersisted(
  createSignal<ColorScheme>("dark"),
  { name: STORAGE_KEY },
);

/** Resolve "system" to the actual OS preference. */
function resolvedIsDark(scheme: ColorScheme): boolean {
  if (scheme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return scheme === "dark";
}

function applyClass(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

// Keep <html> class in sync with the resolved scheme.
let initialized = false;
function init() {
  if (initialized) return;
  initialized = true;

  createEffect(() => {
    const scheme = colorScheme();
    applyClass(resolvedIsDark(scheme));

    // Listen for OS preference changes when set to "system".
    if (scheme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => applyClass(e.matches);
      mq.addEventListener("change", handler);
      onCleanup(() => mq.removeEventListener("change", handler));
    }
  });
}

export function useColorScheme() {
  init();
  return { colorScheme, setColorScheme } as const;
}
