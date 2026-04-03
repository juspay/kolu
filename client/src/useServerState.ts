/**
 * Unified server state — single query for loading, local store for instant reactivity.
 *
 * Preferences use a SolidJS store for synchronous UI updates.
 * Mutations fire to the server in the background; the store is the UI source of truth.
 */

import { createEffect, on } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
  createQuery,
  createMutation,
  useQueryClient,
} from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type {
  ServerState,
  ServerStatePatch,
  Preferences,
  RecentRepo,
  SavedSession,
} from "kolu-common";

const DEFAULT_PREFERENCES: Preferences = {
  seenTips: [],
  startupTips: true,
  randomTheme: true,
  scrollLock: true,
  activityAlerts: true,
  colorScheme: "dark",
};

export function useServerState() {
  const qc = useQueryClient();
  const query = createQuery(() => orpc.state.get.queryOptions());

  // Local reactive store — synced from query, updated directly on mutations.
  const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);

  // Sync store from query on initial load and refetch
  createEffect(
    on(
      () => query.data?.preferences,
      (serverPrefs) => {
        if (serverPrefs) setPrefs(reconcile(serverPrefs));
      },
    ),
  );

  const updateMut = createMutation(() => orpc.state.update.mutationOptions());

  /** Update one or more preferences. Instant local update + async server persist. */
  function updatePreferences(patch: Partial<Preferences>) {
    // Synchronous local update — UI reacts immediately
    setPrefs(patch);
    // Async server persist
    updateMut.mutate({ preferences: patch });
  }

  /** Invalidate state query (e.g. after worktree create changes recent repos). */
  function invalidate() {
    void qc.invalidateQueries({
      queryKey: orpc.state.get.key(),
    });
  }

  return {
    query,
    /** Full server state (undefined while loading). */
    state: () => query.data as ServerState | undefined,
    /** Preferences — local store, synced from server on load. */
    preferences: () => prefs,
    recentRepos: () => (query.data?.recentRepos ?? []) as RecentRepo[],
    savedSession: () => (query.data?.session ?? null) as SavedSession | null,
    updatePreferences,
    invalidate,
  };
}
