/** Terminal store — composes view state and metadata modules.
 *  Terminal list comes from the unified state.get live query.
 *  Client view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  The terminal list is reactive — the server pushes updates on
 *  create/kill/reorder/metadata change through the unified state stream. */

import { useViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";
import { useTerminals } from "./collections";
import { useServerState } from "./useServerState";

export function useTerminalStore() {
  const allTerminals = useTerminals();
  const { isReady } = useServerState();

  const view = useViewState();
  const metadata = useTerminalMetadata({
    allTerminals,
    activeId: view.activeId,
  });

  return {
    // Reactive terminal list from server
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
