/** Terminal store — composes ordering, view state, and metadata modules.
 *  Each concern lives in its own module; this file wires them together. */

import type { TerminalId, ActivitySample } from "kolu-common";
import { useTerminalOrder, type TerminalOrder } from "./useTerminalOrder";
import { useViewState, type ViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

export function useTerminalStore(deps: {
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  const order = useTerminalOrder();
  const view = useViewState();
  const metadata = useTerminalMetadata({
    allTerminalIds: order.allTerminalIds,
    terminalIds: order.terminalIds,
    getSubTerminalIds: order.getSubTerminalIds,
    activeId: view.activeId,
    getActivityHistory: deps.getActivityHistory,
    pushActivity: deps.pushActivity,
  });

  function reset() {
    order.setIdOrder([]);
    order.setSubOrder({});
    view.reset();
  }

  return {
    ...order,
    ...view,
    ...metadata,
    reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
