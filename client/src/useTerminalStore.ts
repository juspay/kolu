/** Terminal store — composes view state and metadata modules.
 *  Server-derived state (list, metadata, ordering) comes from the unified
 *  state.get live query via useServerState.
 *  Client view state (activeId, attention, mruOrder) lives in local signals. */

import { useServerState } from "./useServerState";
import { useViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

export function useTerminalStore() {
  const serverState = useServerState();
  const view = useViewState();
  const metadata = useTerminalMetadata({
    terminals: serverState.terminals,
    activeId: view.activeId,
  });

  return {
    /** Server state query (for loading/data checks). */
    stateQuery: serverState.query,
    /** Terminal list from server state (undefined while loading). */
    terminalList: serverState.terminals,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
