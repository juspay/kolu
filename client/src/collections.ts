/** Server state accessors — singleton live query for persisted state.
 *
 *  The state.get stream pushes ServerState (preferences, session, repos).
 *  Terminal list uses a separate terminal.list stream (dedicated channel
 *  for low-latency list updates without full-state serialization).
 *
 *  This module provides reactive accessors for the persisted state slices.
 *  Terminal list is managed directly by useTerminalStore via terminal.list. */

import { createMemo } from "solid-js";
import { createQuery, type CreateQueryResult } from "@tanstack/solid-query";
import type {
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

/** Preferences from the state stream. */
export function usePreferences() {
  const query = getStateQuery();
  return createMemo(
    (): Preferences => query.data?.preferences ?? DEFAULT_PREFERENCES,
  );
}
