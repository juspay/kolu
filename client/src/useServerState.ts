/** Unified server state — singleton live query for preferences, session, repos.
 *
 *  Terminal list uses a separate terminal.list stream for low-latency updates.
 *  Preferences are derived from the state.get query — live queries drive
 *  SolidJS reactivity synchronously, no dual-state hack needed. */

import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { orpc } from "./orpc";
import { getStateQuery, usePreferences } from "./collections";
import type {
  Preferences,
  ServerState,
  RecentRepo,
  SavedSession,
} from "kolu-common";

export function useServerState() {
  const query = getStateQuery();
  const preferences = usePreferences();
  const qc = useQueryClient();

  const updateMut = createMutation(() => orpc.state.update.mutationOptions());

  /** Update one or more preferences. Instant local update + async server persist. */
  function updatePreferences(patch: Partial<Preferences>) {
    // Optimistic: update TQ cache directly for instant reactivity
    qc.setQueryData(orpc.state.get.key(), (old: ServerState | undefined) =>
      old ? { ...old, preferences: { ...old.preferences, ...patch } } : old,
    );
    // Server persist — live stream will push authoritative value back
    updateMut.mutate({ preferences: patch });
  }

  /** Invalidate state query (e.g. after worktree create changes recent repos). */
  function invalidate() {
    void qc.invalidateQueries({
      queryKey: orpc.state.get.key(),
    });
  }

  return {
    /** Full server state (undefined while loading). */
    state: () => query.data as ServerState | undefined,
    /** Preferences — derived from live query, instant reactivity. */
    preferences,
    recentRepos: () => (query.data?.recentRepos ?? []) as RecentRepo[],
    savedSession: () => (query.data?.session ?? null) as SavedSession | null,
    updatePreferences,
    invalidate,
  };
}
