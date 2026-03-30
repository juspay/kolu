/** Terminal store — combines server state (TanStack) with client view state.
 *  Server-derived state (metadata) lives in TanStack cache via createQueries.
 *  Client view state (activeId, attention, mruOrder) lives in local signals/store. */

import {
  type Accessor,
  createSignal,
  createEffect,
  on,
  createMemo,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import { createQueries } from "@tanstack/solid-query";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
} from "kolu-common";
import { orpc } from "./orpc";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminalStore(deps: {
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  // --- Terminal ordering (server-derived, hydrated from terminal.list) ---
  const [idOrder, setIdOrder] = createSignal<TerminalId[]>([]);
  const [subOrder, setSubOrder] = createSignal<
    Record<TerminalId, TerminalId[]>
  >({});

  const terminalIds = idOrder;

  /** Get sub-terminal IDs for a given parent. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  // --- View state: per-browser-tab UI state ---
  const [activeId, setActiveId] = makePersisted(
    createSignal<TerminalId | null>(null),
    {
      name: ACTIVE_TERMINAL_KEY,
      serialize: (v) => (v === null ? "" : v),
      deserialize: (s) => (s === "" ? null : (s as TerminalId)),
    },
  );

  /** Terminals with unseen Claude completions (cleared when user visits). */
  const [attention, setAttention] = createStore<Record<TerminalId, true>>({});

  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      // Clear attention when user visits the terminal
      if (attention[id]) setAttention(id, undefined as never);
    }),
  );

  function markAttention(id: TerminalId) {
    setAttention(id, true);
  }

  function needsAttention(id: TerminalId): boolean {
    return !!attention[id];
  }

  // --- TanStack live queries: one metadata stream per terminal ---
  /** All terminal IDs (top-level + sub-terminals) for live query subscriptions. */
  const allTerminalIds = createMemo(() =>
    terminalIds().flatMap((id) => [id, ...getSubTerminalIds(id)]),
  );

  const metadataQueries = createQueries(() => ({
    queries: allTerminalIds().map((id) =>
      orpc.terminal.onMetadataChange.experimental_liveOptions({
        input: { id },
      }),
    ),
  }));

  /** Get server metadata for a terminal from TanStack cache. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const idx = allTerminalIds().indexOf(id);
    return idx >= 0 ? metadataQueries[idx]?.data : undefined;
  }

  // Watch busy changes across all terminals → push to activity history fold.
  const prevBusy = new Map<TerminalId, boolean>();
  createEffect(() => {
    const ids = allTerminalIds();
    for (const id of prevBusy.keys()) {
      if (!ids.includes(id)) prevBusy.delete(id);
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const busy = metadataQueries[i]?.data?.busy;
      if (busy === undefined) continue;
      const prev = prevBusy.get(id);
      if (prev !== busy) {
        deps.pushActivity(id, busy);
      }
      prevBusy.set(id, busy);
    }
  });

  // --- Derived accessors ---

  /** The active terminal's metadata (for header display). */
  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  /** Complete display info per terminal: metadata + colors + activity + sub-count. */
  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      terminalIds(),
      (id) => ({ meta: getMetadata(id) }),
      deps.getActivityHistory,
      getSubTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

  /** Human-readable label for a terminal by its sidebar position. */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  /** Reset all state to defaults — used by bulk operations like close-all. */
  function reset() {
    setIdOrder([]);
    setSubOrder({});
    setActiveId(null);
    setMruOrder([]);
    setAttention(reconcile({}));
  }

  return {
    // Ordering
    idOrder,
    setIdOrder,
    subOrder,
    setSubOrder,
    terminalIds,
    getSubTerminalIds,
    // View state
    activeId,
    setActiveId,
    mruOrder,
    setMruOrder,
    attention,
    markAttention,
    needsAttention,
    // Server metadata (TanStack)
    getMetadata,
    activeMeta,
    // Display
    getDisplayInfo,
    terminalLabel,
    // Lifecycle helpers
    reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
