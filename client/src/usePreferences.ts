/** User preferences — server-backed via conf, cached with TanStack Query. */

import {
  createMutation,
  createQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type { UserPreferences, UserPreferencesUpdate } from "kolu-common";

/** Shared query options — all preference consumers share this cache entry. */
export const prefsQueryOptions = () => orpc.preferences.get.queryOptions();

/** Shared query + optimistic mutation for preferences. Deduplicates across consumers via TanStack cache. */
export function usePrefsQuery() {
  const qc = useQueryClient();
  const query = createQuery(prefsQueryOptions);
  const mutation = createMutation(() => ({
    ...orpc.preferences.set.mutationOptions(),
    onSuccess: (data: UserPreferences) => {
      qc.setQueryData(orpc.preferences.get.key(), data);
    },
  }));

  /** Optimistic update + server persist. */
  function update(patch: UserPreferencesUpdate) {
    qc.setQueryData(
      orpc.preferences.get.key(),
      (old: UserPreferences | undefined) => (old ? { ...old, ...patch } : old),
    );
    mutation.mutate(patch);
  }

  return { query, update } as const;
}

export function usePreferences() {
  const { query, update } = usePrefsQuery();

  return {
    query,
    randomTheme: () => query.data?.randomTheme ?? true,
    setRandomTheme: (v: boolean) => update({ randomTheme: v }),
    scrollLock: () => query.data?.scrollLock ?? true,
    setScrollLock: (v: boolean) => update({ scrollLock: v }),
    activityAlerts: () => query.data?.activityAlerts ?? true,
    setActivityAlerts: (v: boolean) => update({ activityAlerts: v }),
    update,
  } as const;
}
