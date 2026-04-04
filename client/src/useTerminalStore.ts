/** Terminal store — composes view state and metadata modules.
 *  Terminal list comes from TanStack DB collection (synced via state.get stream).
 *  Client view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  The terminal list is reactive via useLiveQuery — the server pushes updates on
 *  create/kill/reorder/metadata change through the unified state stream. */

import { createMemo } from "solid-js";
import { useLiveQuery } from "@tanstack/solid-db";
import { terminalsCollection } from "./collections";
import { useViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";
import type { TerminalInfo } from "kolu-common";

export function useTerminalStore() {
  const terminalsQuery = useLiveQuery((q) =>
    q.from({ t: terminalsCollection }),
  );

  /** All terminals as a plain reactive array. */
  const allTerminals = createMemo(
    (): TerminalInfo[] => (terminalsQuery() as TerminalInfo[]) ?? [],
  );

  /** Whether the initial terminal list has loaded. */
  const isReady = () => terminalsQuery.isReady;

  const view = useViewState();
  const metadata = useTerminalMetadata({
    allTerminals,
    activeId: view.activeId,
  });

  return {
    // Reactive terminal list from collection
    allTerminals,
    isReady,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
