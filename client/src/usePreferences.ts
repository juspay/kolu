/** User preferences — persisted booleans independent of terminal state. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

/** Create a persisted boolean signal backed by localStorage. */
function persistedBool(name: string, initial = true) {
  return makePersisted(createSignal(initial), {
    name,
    serialize: String,
    deserialize: (s) => s !== "false",
  });
}

const [randomTheme, setRandomTheme] = persistedBool("kolu-random-theme");
const [scrollLock, setScrollLock] = persistedBool("kolu-scroll-lock");
const [notifications, setNotifications] = persistedBool("kolu-notifications");

export function usePreferences() {
  return {
    randomTheme,
    setRandomTheme,
    scrollLock,
    setScrollLock,
    notifications,
    setNotifications,
  } as const;
}
