/** Terminal store — shared substrate for all terminal state modules.
 *  Signals, store, derived accessors, and reactive effects (MRU tracking).
 *  No server calls, no subscriptions. */

import {
  type Accessor,
  createSignal,
  createEffect,
  on,
  createMemo,
} from "solid-js";
import { createStore, type SetStoreFunction } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
} from "kolu-common";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

/** Per-terminal metadata stored client-side. Same shape as TerminalInfo minus the id (used as key). */
export type TerminalState = Omit<TerminalInfo, "id" | "activityHistory"> & {
  notified?: boolean;
};

export type TerminalMetaStore = Record<TerminalId, TerminalState>;
export type SetTerminalMeta = SetStoreFunction<TerminalMetaStore>;

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useTerminalStore(deps: {
  getActivityHistory: (id: TerminalId) => ActivitySample[];
}) {
  // Single store: all per-terminal metadata keyed by ID.
  // Fine-grained reactivity — updating one terminal's metadata doesn't re-render others.
  const [meta, setMeta] = createStore<Record<TerminalId, TerminalState>>({});
  // Explicit ordering — UUIDs don't sort chronologically, so track insertion order.
  // Only top-level terminals (no parentId) live here.
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
  // Updated whenever activeId changes. Most recent first.
  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      // Clear notification when user visits the terminal
      if (meta[id]?.notified) setMeta(id, "notified", false);
    }),
  );

  /** Get sub-terminal IDs for a given parent. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return subOrder()[parentId] ?? [];
  }

  /** Get metadata for a terminal. */
  function getMeta(id: TerminalId): TerminalState | undefined {
    return meta[id];
  }

  /** The active terminal's metadata (for header display). */
  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = activeId();
    return id !== null ? (meta[id]?.meta ?? null) : null;
  });

  /** Complete display info per terminal: metadata + colors + activity + sub-count. */
  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      terminalIds(),
      getMeta,
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

  /** Convert a TerminalInfo (wire type) to store entry (strip id and activityHistory).
   *  Ensures `meta` is always present so SolidJS store tracks it from creation —
   *  without this, setting `meta` later via subscription won't trigger memo re-runs. */
  function infoToState(t: TerminalInfo): TerminalState {
    const { id: _, activityHistory: _history, ...state } = t;
    return { meta: undefined, ...state };
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
    getMeta,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
    infoToState,
  };
}

export type TerminalStore = ReturnType<typeof useTerminalStore>;
