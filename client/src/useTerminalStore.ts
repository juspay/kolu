/** Terminal store — composes view state and metadata modules.
 *  Server-derived state (including ordering) lives in TanStack cache.
 *  Client view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  The terminal list is a live query — the server pushes updates on
 *  create/kill/reorder. No manual client-side bookkeeping needed. */

import { createQuery } from "@tanstack/solid-query";
import type { TerminalInfo } from "kolu-common";
import { orpc } from "./orpc";
import { useViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

export function useTerminalStore() {
  const listQuery = createQuery(() =>
    orpc.terminal.list.experimental_liveOptions(),
  );

  const listData = (): TerminalInfo[] | undefined => listQuery.data;

  const view = useViewState();
  const metadata = useTerminalMetadata({
    listData,
    activeId: view.activeId,
  });

  return {
    // Live terminal list from server
    listData,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
