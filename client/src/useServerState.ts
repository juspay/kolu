/** Unified server state — TanStack DB collections for reactive sync.
 *
 *  Preferences come from the preferencesCollection (Solid-native reactivity).
 *  No dual-state hack needed — useLiveQuery returns reactive data directly. */

import { createMemo } from "solid-js";
import { createMutation } from "@tanstack/solid-query";
import { useLiveQuery } from "@tanstack/solid-db";
import { orpc } from "./orpc";
import {
  preferencesCollection,
  getLatestServerState,
  getRecentRepos,
  getSavedSession,
} from "./collections";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import type { Preferences } from "kolu-common";

export function useServerState() {
  const prefsQuery = useLiveQuery((q) =>
    q.from({ p: preferencesCollection }).findOne(),
  );

  const preferences = createMemo((): Preferences => {
    const row = prefsQuery();
    if (!row) return DEFAULT_PREFERENCES;
    const { _key, ...prefs } = row;
    return prefs;
  });

  const updateMut = createMutation(() => orpc.state.update.mutationOptions());

  /** Update one or more preferences. Instant local update + async server persist. */
  function updatePreferences(patch: Partial<Preferences>) {
    // Optimistic local update via direct write to synced store
    const current = preferencesCollection.get("default");
    if (current) {
      preferencesCollection.utils.writeUpdate({
        ...current,
        ...patch,
      });
    }
    // Server persist — state stream will push authoritative value back
    updateMut.mutate({ preferences: patch });
  }

  return {
    /** Full server state (undefined while loading). */
    state: getLatestServerState,
    /** Preferences — reactive via TanStack DB collection. */
    preferences,
    recentRepos: getRecentRepos,
    savedSession: getSavedSession,
    updatePreferences,
    isReady: () => prefsQuery.isReady,
  };
}
