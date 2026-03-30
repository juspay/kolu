/** Terminal store — shared substrate for all terminal state modules.
 *  Client-only state (notified, parentId) in SolidJS store.
 *  Server-derived state (metadata) in TanStack cache via createQueries. */

import {
  type Accessor,
  createSignal,
  createEffect,
  on,
  createMemo,
} from "solid-js";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
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

/** Per-terminal client-only state. Server-derived fields live in TanStack cache. */
export type TerminalClientState = {
  notified?: boolean;
  parentId?: string;
};

export type TerminalMetaStore = Record<TerminalId, TerminalClientState>;
export type SetTerminalMeta = SetStoreFunction<TerminalMetaStore>;

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminalStore(deps: {
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  // Client-only store: notified flag and parentId per terminal.
  const [meta, setMeta] = createStore<TerminalMetaStore>({});
  // Explicit ordering — UUIDs don't sort chronologically, so track insertion order.
  const [idOrder, setIdOrder] = createSignal<TerminalId[]>([]);
  // Sub-terminal ordering per parent.
  const [subOrder, setSubOrder] = createSignal<
    Record<TerminalId, TerminalId[]>
  >({});

  const [activeId, setActiveId] = makePersisted(
    createSignal<TerminalId | null>(null),
    {
      name: ACTIVE_TERMINAL_KEY,
      serialize: (v) => (v === null ? "" : v),
      deserialize: (s) => (s === "" ? null : (s as TerminalId)),
    },
  );

  const terminalIds = idOrder;

  // MRU (most-recently-used) order: tracks terminal switch history for quick-switch.
  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      // Clear notification when user visits the terminal
      if (meta[id]?.notified) setMeta(id, "notified", false);
    }),
  );

  /** All terminal IDs (top-level + sub-terminals) for live query subscriptions. */
  const allTerminalIds = createMemo(() =>
    terminalIds().flatMap((id) => [id, ...getSubTerminalIds(id)]),
  );

  // --- TanStack live queries: one metadata stream per terminal ---
  // createQueries dynamically adds/removes queries as terminals come and go.
  // Covers all terminals (top-level + sub-terminals).
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
    // Prune removed terminals
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

  /** Get sub-terminal IDs for a given parent. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  /** Get client state for a terminal (notified, parentId). */
  function getClientState(id: TerminalId): TerminalClientState | undefined {
    return meta[id];
  }

  /** Get combined view: client state + server metadata. For consumers that need both. */
  function getMeta(id: TerminalId): (TerminalClientState & { meta?: TerminalMetadata }) | undefined {
    const client = meta[id];
    if (!client) return undefined;
    return { ...client, meta: getMetadata(id) };
  }

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

  /** Convert a TerminalInfo (wire type) to client store entry. */
  function infoToState(t: TerminalInfo): TerminalClientState {
    return { parentId: t.parentId };
  }

  /** Reset all state to defaults — used by bulk operations like close-all. */
  function reset() {
    setMeta(reconcile({}));
    setIdOrder([]);
    setSubOrder({});
    setActiveId(null);
    setMruOrder([]);
  }

  return {
    meta,
    setMeta,
    idOrder,
    setIdOrder,
    subOrder,
    setSubOrder,
    activeId,
    setActiveId,
    terminalIds,
    mruOrder,
    setMruOrder,
    getSubTerminalIds,
    getClientState,
    getMeta,
    getMetadata,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
    infoToState,
    reset,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
