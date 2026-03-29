/** User preferences — persisted booleans independent of terminal state. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

const [randomTheme, setRandomTheme] = makePersisted(createSignal(true), {
  name: "kolu-random-theme",
  serialize: String,
  deserialize: (s) => s !== "false",
});

const [scrollLock, setScrollLock] = makePersisted(createSignal(true), {
  name: "kolu-scroll-lock",
  serialize: String,
  deserialize: (s) => s !== "false",
});

const [activityAlerts, setActivityAlerts] = makePersisted(createSignal(true), {
  name: "kolu-activity-alerts",
  serialize: String,
  deserialize: (s) => s !== "false",
});

export function usePreferences() {
  return {
    randomTheme,
    setRandomTheme,
    scrollLock,
    setScrollLock,
    activityAlerts,
    setActivityAlerts,
  } as const;
}
