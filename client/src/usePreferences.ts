/**
 * User preferences — backed by server-side persistent state via conf.
 *
 * Fetches preferences on mount via TanStack Query, mutates via oRPC.
 * Provides the same reactive API as the old localStorage-backed version
 * so consumers (App.tsx, SettingsPopover) need minimal changes.
 */

import { createMemo } from "solid-js";
import {
  createMutation,
  createQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type {
  ColorScheme,
  UserPreferences,
  UserPreferencesPartial,
} from "kolu-common";
import { DEFAULT_PREFERENCES } from "kolu-common/config";

export function usePreferences() {
  const qc = useQueryClient();
  const query = createQuery(() => orpc.preferences.get.queryOptions());

  const prefs = createMemo(() => query.data ?? DEFAULT_PREFERENCES);

  const queryKey = orpc.preferences.get.queryOptions().queryKey;

  const mutation = createMutation(() => ({
    ...orpc.preferences.set.mutationOptions(),
    onMutate: async (partial: UserPreferencesPartial) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, (old: UserPreferences | undefined) =>
        old ? { ...old, ...partial } : { ...DEFAULT_PREFERENCES, ...partial },
      );
      return { prev };
    },
    onError: (
      _err: Error,
      _vars: UserPreferencesPartial,
      ctx: { prev?: UserPreferences } | undefined,
    ) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  }));

  function update(partial: UserPreferencesPartial) {
    mutation.mutate(partial);
  }

  return {
    randomTheme: () => prefs().randomTheme,
    setRandomTheme: (on: boolean) => update({ randomTheme: on }),

    scrollLock: () => prefs().scrollLock,
    setScrollLock: (on: boolean) => update({ scrollLock: on }),

    activityAlerts: () => prefs().activityAlerts,
    setActivityAlerts: (on: boolean) => update({ activityAlerts: on }),

    colorScheme: () => prefs().colorScheme as ColorScheme,
    setColorScheme: (scheme: ColorScheme) => update({ colorScheme: scheme }),

    startupTips: () => prefs().startupTips,
    setStartupTips: (on: boolean) => update({ startupTips: on }),

    seenTips: () => prefs().seenTips,
    setSeenTips: (tips: string[]) => update({ seenTips: tips }),
  } as const;
}
