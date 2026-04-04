/** Server state collections — wraps the unified state.get live query.
 *
 *  The state.get stream (managed by TanStack Query) pushes full ServerState.
 *  This module provides reactive accessors for derived slices (terminals,
 *  preferences) without N+1 queries or manual cache key construction.
 *
 *  TODO: Migrate to TanStack DB collections once sync-function reactivity
 *  is verified with the oRPC WebSocket transport. */

import { createMemo } from "solid-js";
import { createQuery, type CreateQueryResult } from "@tanstack/solid-query";
import type {
  TerminalInfo,
  ServerState,
  Preferences,
  RecentRepo,
  SavedSession,
} from "kolu-common";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import { orpc } from "./orpc";

// --- Singleton live query ---

type StateQuery = CreateQueryResult<ServerState>;
let _query: StateQuery | undefined;

/** Initialize or return the singleton state.get live query.
 *  Must be called inside a Solid reactive context (component or effect). */
export function getStateQuery(): StateQuery {
  if (!_query) {
    _query = createQuery(() => orpc.state.get.experimental_liveOptions());
  }
  return _query;
}

// --- Reactive accessors ---

/** All terminals from the unified state stream. */
export function useTerminals() {
  const query = getStateQuery();
  return createMemo((): TerminalInfo[] => query.data?.terminals ?? []);
}

/** Preferences from the unified state stream. */
export function usePreferences() {
  const query = getStateQuery();
  return createMemo(
    (): Preferences => query.data?.preferences ?? DEFAULT_PREFERENCES,
  );
}

/** Recent repos from the unified state stream. */
export function useRecentRepos() {
  const query = getStateQuery();
  return createMemo((): RecentRepo[] => query.data?.recentRepos ?? []);
}

/** Saved session from the unified state stream. */
export function useSavedSession() {
  const query = getStateQuery();
  return createMemo((): SavedSession | null => query.data?.session ?? null);
}
