/** User preferences — persisted booleans independent of terminal state. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

const RANDOM_THEME_KEY = "kolu-random-theme";
const SCROLL_LOCK_KEY = "kolu-scroll-lock";

let cached: ReturnType<typeof createPreferences> | undefined;

function createPreferences() {
  const [randomTheme, setRandomTheme] = makePersisted(createSignal(true), {
    name: RANDOM_THEME_KEY,
    serialize: String,
    deserialize: (s) => s !== "false",
  });

  const [scrollLock, setScrollLock] = makePersisted(createSignal(true), {
    name: SCROLL_LOCK_KEY,
    serialize: String,
    deserialize: (s) => s !== "false",
  });

  return { randomTheme, setRandomTheme, scrollLock, setScrollLock };
}

export function usePreferences() {
  if (!cached) cached = createPreferences();
  return cached;
}
