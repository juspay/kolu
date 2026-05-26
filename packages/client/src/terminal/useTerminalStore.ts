/** Terminal store — composes view state and metadata.
 *
 *  Server-derived state streams through the surface client bundle's
 *  module-level subscriptions in `wire.ts` (`terminalListSub`); client view
 *  state (activeId, attention, mruOrder) lives in local signals.
 *
 *  Singleton via `createSharedRoot`: every consumer (WorkspaceSwitcher,
 *  ChromeBar, TerminalCanvas, mobile sheet, tile theme) reads the same
 *  store, so derivations like `getDisplayInfo` and `getMetadata` flow
 *  without prop-drilling lookup functions through layout components. */

import { createSharedRoot } from "../createSharedRoot";
import { useViewState } from "../useViewState";
import { terminalListSub } from "../wire";
import { useTerminalMetadata } from "./useTerminalMetadata";

export const useTerminalStore = createSharedRoot(() => {
  const view = useViewState();
  const metadata = useTerminalMetadata({
    list: terminalListSub,
    activeId: view.activeId,
  });

  return {
    // Live terminal list from server (Subscription<TerminalInfo[]>).
    listSub: terminalListSub,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
});

export type TerminalStore = ReturnType<typeof useTerminalStore>;
