/** Terminal store — composes view state and metadata modules.
 *  Server-derived state streams via createSubscription.
 *  Client view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  The terminal list is a live subscription — the server pushes updates on
 *  create/kill. No manual client-side bookkeeping needed.
 *
 *  Singleton (cached + createRoot): every consumer (PillTree, ChromeBar,
 *  TerminalCanvas, mobile sheet, tile theme) reads the same store, so
 *  derivations like `getDisplayInfo` and `getMetadata` flow without
 *  prop-drilling lookup functions through layout components. */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import { useViewState } from "../useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

function init() {
  const listSub = createSubscription(() => stream.terminalList(), {
    onError: (err) => toast.error(`Terminal list error: ${err.message}`),
  });

  const view = useViewState();
  const metadata = useTerminalMetadata({
    listSub,
    activeId: view.activeId,
  });

  return {
    // Live terminal list from server
    listSub,
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
