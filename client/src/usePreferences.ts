/** User preferences — reads from server state, writes via mutation. */

import { useServerState } from "./useServerState";

export function usePreferences() {
  const { preferences, updatePreferences } = useServerState();

  return {
    randomTheme: () => preferences().randomTheme,
    setRandomTheme: (on: boolean) => updatePreferences({ randomTheme: on }),
    scrollLock: () => preferences().scrollLock,
    setScrollLock: (on: boolean) => updatePreferences({ scrollLock: on }),
    activityAlerts: () => preferences().activityAlerts,
    setActivityAlerts: (on: boolean) =>
      updatePreferences({ activityAlerts: on }),
  } as const;
}
