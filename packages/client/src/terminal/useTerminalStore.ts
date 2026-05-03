/** Terminal store — composes view state and metadata.
 *
 *  Server-derived state streams through the surface client bundle's
 *  module-level subscriptions in `wire.ts` (`terminalListSub`); client view
 *  state (activeId, attention, mruOrder) lives in local signals.
 *
 *  Singleton (cached + createRoot): every consumer (PillTree, ChromeBar,
 *  TerminalCanvas, mobile sheet, tile theme) reads the same store, so
 *  derivations like `getDisplayInfo` and `getMetadata` flow without
 *  prop-drilling lookup functions through layout components. */

import { createRoot } from "solid-js";
import { useViewState } from "../useViewState";
import { terminalListSub } from "../wire";
import { useTerminalMetadata } from "./useTerminalMetadata";

function init() {
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
}

let cached: ReturnType<typeof init> | undefined;

export function useTerminalStore() {
  if (!cached) cached = createRoot(() => init());
  return cached;
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
