/** View state — per-browser-tab UI state that has no server representation.
 *  Which terminal is selected, which need attention, MRU switch history. */

import { createSignal, createEffect, on } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";

const ACTIVE_TERMINAL_KEY = "kolu-active-terminal";

export function useViewState() {
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
      if (attention[id]) setAttention(produce((s) => delete s[id]));
    }),
  );

  function markAttention(id: TerminalId) {
    setAttention(id, true);
  }

  function needsAttention(id: TerminalId): boolean {
    return !!attention[id];
  }

  function reset() {
    setActiveId(null);
    setMruOrder([]);
    setAttention(reconcile({}));
  }

  return {
    activeId,
    setActiveId,
    mruOrder,
    setMruOrder,
    markAttention,
    needsAttention,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
