/** Terminal store — composes view state and metadata modules.
 *  Server-derived state streams via createSubscription.
 *  Client view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  The terminal list is a live subscription — the server pushes updates on
 *  create/kill/reorder. No manual client-side bookkeeping needed. */

import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import { useViewState } from "../useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

export function useTerminalStore() {
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

export type TerminalStore = ReturnType<typeof useTerminalStore>;
