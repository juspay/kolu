/** Unified server state — singleton live query for all server-synced data.
 *
 *  One state.get stream replaces the old fragmented queries (terminal.list,
 *  onMetadataChange, separate state.get). Preferences are derived directly
 *  from the query data — no dual-state hack needed since live queries
 *  drive SolidJS reactivity synchronously. */

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

  return {
    /** Full server state (undefined while loading). */
    state: () => query.data as ServerState | undefined,
    /** Preferences — derived from live query, instant reactivity. */
    preferences,
    recentRepos: () => (query.data?.recentRepos ?? []) as RecentRepo[],
    savedSession: () => (query.data?.session ?? null) as SavedSession | null,
    updatePreferences,
    isReady: () => !query.isLoading,
  };
}
