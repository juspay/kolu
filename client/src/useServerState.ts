/**
 * Unified server state — live query for server sync, local store for instant UI reactivity.
 *
 * Architecture:
 * - Live query (experimental_liveOptions): server pushes state changes over WebSocket
 * - Singleton SolidJS store: synchronous UI updates for preferences
 * - reconcile effect: syncs live query → local store on every server push
 * - updatePreferences: instant local store update + async server mutation
 *
 * Why both? TanStack Query's setQueryData notifications go through setTimeout(0),
 * which is too slow for instant toggle feedback. The local store handles synchronous
 * reactivity; the live query handles server sync.
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

// Singleton store — all callers share one reactive source of truth for preferences.
const [prefs, setPrefs] = createStore<Preferences>(DEFAULT_PREFERENCES);
let storeInitialized = false;

export function useServerState() {
  const qc = useQueryClient();
  const query = createQuery(() => orpc.state.get.experimental_liveOptions());

  // Sync singleton store from live query — only the first caller wires this up.
  if (!storeInitialized) {
    storeInitialized = true;
    createEffect(
      on(
        () => query.data?.preferences,
        (serverPrefs) => {
          if (serverPrefs) setPrefs(reconcile(serverPrefs));
        },
      ),
    );
  }

  const updateMut = createMutation(() => orpc.state.update.mutationOptions());

  /** Update one or more preferences. Instant local update + async server persist. */
  function updatePreferences(patch: Partial<Preferences>) {
    // Synchronous local update — UI reacts immediately (singleton store)
    setPrefs(patch);
    // Server persist — live stream will push authoritative state back via reconcile
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
    /** Preferences — singleton store, synced from live query on every server push. */
    preferences: () => prefs,
    recentRepos: () => (query.data?.recentRepos ?? []) as RecentRepo[],
    savedSession: () => (query.data?.session ?? null) as SavedSession | null,
    updatePreferences,
    invalidate,
  };
}
