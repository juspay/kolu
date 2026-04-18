/** View state — per-browser-tab UI state.
 *  Which terminal is selected, which have unread completions, MRU switch
 *  history. Active terminal is reported to server for session snapshots
 *  and restored via useSessionRestore on reconnect.
 *  Viewport grid lives in `useViewport.ts` — it's shared across
 *  every main terminal, not keyed per id. */

import { createSignal, createEffect, on } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";
import { client } from "./rpc/rpc";

export function useViewState() {
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);

  /** Whether the workspace is in fullscreen-one-tile mode. The active
   *  tile is always the one rendered fullscreen, so this is a pure mode
   *  flag. Persisted to localStorage so the posture survives reload —
   *  it's a per-tab view preference, not session state, so it lives
   *  alongside other view prefs (e.g. minimap-expanded), not in the
   *  server's SavedSession. */
  const [canvasMaximized, setCanvasMaximizedSignal] = makePersisted(
    createSignal(false),
    { name: "kolu-canvas-maximized" },
  );

  /** Terminals with unseen Claude completions (cleared when user visits). */
  const [unread, setUnread] = createStore<Record<TerminalId, true>>({});

  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      if (unread[id]) setUnread(produce((s) => delete s[id]));
      // Report active terminal to server for session snapshots
      void client.terminal.setActive({ id }).catch(() => {});
    }),
  );

  function toggleCanvasMaximized() {
    setCanvasMaximizedSignal((prev) => !prev);
  }

  function markUnread(id: TerminalId) {
    setUnread(id, true);
  }

  function isUnread(id: TerminalId): boolean {
    return !!unread[id];
  }

  function reset() {
    setActiveId(null);
    setCanvasMaximizedSignal(false);
    setMruOrder([]);
    setUnread(reconcile({}));
  }

  return {
    activeId,
    setActiveId,
    canvasMaximized,
    toggleCanvasMaximized,
    mruOrder,
    setMruOrder,
    markUnread,
    isUnread,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
