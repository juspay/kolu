/** Terminal store — composes view state and metadata modules.
 *  Server-derived state (including ordering) lives in TanStack cache.
 *  Client view state (activeId, attention, mruOrder) lives in local signals. */

import { createSignal } from "solid-js";
import type { TerminalId, ActivitySample } from "kolu-common";
import { useViewState } from "./useViewState";
import { useTerminalMetadata } from "./useTerminalMetadata";

export function useTerminalStore(deps: {
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  /** Unordered set of known terminal IDs — drives TanStack query subscriptions.
   *  Order is derived from metadata sortOrder, not from this array. */
  const [knownIds, setKnownIds] = createSignal<TerminalId[]>([]);

  const view = useViewState();
  const metadata = useTerminalMetadata({
    knownIds,
    activeId: view.activeId,
    getActivityHistory: deps.getActivityHistory,
    pushActivity: deps.pushActivity,
  });

  function addKnownId(id: TerminalId) {
    setKnownIds((prev) => [...prev, id]);
  }

  function removeKnownId(id: TerminalId) {
    setKnownIds((prev) => prev.filter((x) => x !== id));
  }

  function reset() {
    setKnownIds([]);
    view.reset();
  }

  return {
    // Known IDs (unordered — for subscription management)
    knownIds,
    setKnownIds,
    addKnownId,
    removeKnownId,
    // View state
    ...view,
    // Server metadata + derived ordering
    ...metadata,
    // Lifecycle
    reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
