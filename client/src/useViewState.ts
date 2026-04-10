/** View state — per-browser-tab UI state that has no server representation.
 *  Which terminal is selected, which have unread completions, MRU switch
 *  history. Viewport grid lives in `useViewport.ts` — it's shared across
 *  every main terminal, not keyed per id. */

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
  const [unread, setUnread] = createStore<Record<TerminalId, true>>({});

  /** Terminals whose waiting state the user has already seen (set on visit,
   *  cleared when Claude's state transitions — so the preview reappears on
   *  the *next* waiting transition). */
  const [acknowledged, setAcknowledged] = createStore<Record<TerminalId, true>>(
    {},
  );

  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      if (unread[id]) setUnread(produce((s) => delete s[id]));
      setAcknowledged(id, true);
    }),
  );

  function markUnread(id: TerminalId) {
    setUnread(id, true);
  }

  function isUnread(id: TerminalId): boolean {
    return !!unread[id];
  }

  function clearAcknowledged(id: TerminalId) {
    if (acknowledged[id]) setAcknowledged(produce((s) => delete s[id]));
  }

  function isAcknowledged(id: TerminalId): boolean {
    return !!acknowledged[id];
  }

  function reset() {
    setActiveId(null);
    setMruOrder([]);
    setUnread(reconcile({}));
    setAcknowledged(reconcile({}));
  }

  return {
    activeId,
    setActiveId,
    mruOrder,
    setMruOrder,
    markUnread,
    isUnread,
    clearAcknowledged,
    isAcknowledged,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
