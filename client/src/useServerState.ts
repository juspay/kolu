/** Unified server state — single query + mutation for preferences, recent repos, and session. */

import {
  createQuery,
  createMutation,
  useQueryClient,
} from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type { ServerState, ServerStatePatch, Preferences } from "kolu-common";

const stateKey = () => orpc.state.get.key();

export function useServerState() {
  const qc = useQueryClient();
  const query = createQuery(() => orpc.state.get.queryOptions());

  const updateMut = createMutation(() => ({
    ...orpc.state.update.mutationOptions(),
    onMutate: async (patch: ServerStatePatch) => {
      await qc.cancelQueries({ queryKey: stateKey() });
      const prev = qc.getQueryData<ServerState>(stateKey());
      if (prev) {
        qc.setQueryData<ServerState>(stateKey(), {
          recentRepos: patch.recentRepos ?? prev.recentRepos,
          session: patch.session !== undefined ? patch.session : prev.session,
          preferences: patch.preferences
            ? { ...prev.preferences, ...patch.preferences }
            : prev.preferences,
        });
      }
      return { prev };
    },
    onError: (
      _err: Error,
      _patch: ServerStatePatch,
      context: { prev?: ServerState } | undefined,
    ) => {
      if (context?.prev) qc.setQueryData(stateKey(), context.prev);
    },
  }));

  /** Update one or more preferences. Optimistic — rolls back on error. */
  function updatePreferences(patch: Partial<Preferences>) {
    updateMut.mutate({ preferences: patch });
  }

  /** Invalidate state query (e.g. after worktree create changes recent repos). */
  function invalidate() {
    void qc.invalidateQueries({ queryKey: stateKey() });
  }

  return {
    query,
    /** Full server state (undefined while loading). */
    state: () => query.data as ServerState | undefined,
    /** Preferences accessor (falls back to defaults while loading). */
    preferences: () =>
      query.data?.preferences ?? {
        seenTips: [],
        startupTips: true,
        randomTheme: true,
        scrollLock: true,
        activityAlerts: true,
        colorScheme: "dark" as const,
      },
    recentRepos: () => query.data?.recentRepos ?? [],
    savedSession: () => query.data?.session ?? null,
    updatePreferences,
    invalidate,
  };
}
