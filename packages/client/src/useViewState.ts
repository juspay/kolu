/** View state — per-browser-tab UI state.
 *  Which terminal is selected, which have unread completions, MRU switch
 *  history. Active terminal is reported to server for session snapshots
 *  and restored via useSessionRestore on reconnect.
 *  Terminal grid dimensions are per-instance — each xterm measures its
 *  own container via FitAddon. */

import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId } from "kolu-common";
import { createEffect, createSignal, on } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { client } from "./rpc/rpc";

type TerminalAttention = "unread" | "badge-only";

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

  /** Terminals needing attention. `unread` drives in-app dots and badges;
   *  `badge-only` is for OS/PWA attention that should not show an in-app dot. */
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});

  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);
  createEffect(
    on(activeId, (id) => {
      if (id === null) return;
      setMruOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
      if (attention[id] === "unread")
        setAttention(produce((s) => delete s[id]));
      // Report active terminal to server for session snapshots
      void client.terminal.setActive({ id }).catch(() => {});
    }),
  );

  /** The single writer for `canvasMaximized`. Canvas readers reach this
   *  via `useViewPosture()` (`packages/client/src/canvas/useViewPosture.ts`)
   *  — the posture hook is the public seam so a future enum upgrade
   *  (PiP, per-tile maximize) can be absorbed there without rippling
   *  across readers. Treat `canvasMaximized` / `toggleCanvasMaximized`
   *  on the store as internal-to-posture; new call sites should import
   *  the hook instead. Tracked: kolu#628. */
  function toggleCanvasMaximized() {
    setCanvasMaximizedSignal((prev) => !prev);
  }

  function markUnread(id: TerminalId) {
    setAttention(id, "unread");
  }

  function markBadgeAttention(id: TerminalId) {
    if (attention[id] !== "unread") setAttention(id, "badge-only");
  }

  function clearBadgeAttention() {
    setAttention(
      produce((s) => {
        for (const id of Object.keys(s) as TerminalId[]) {
          if (s[id] === "badge-only") delete s[id];
        }
      }),
    );
  }

  function isUnread(id: TerminalId): boolean {
    return attention[id] === "unread";
  }

  function hasBadgeAttention(id: TerminalId): boolean {
    return attention[id] !== undefined;
  }

  function reset() {
    setActiveId(null);
    setCanvasMaximizedSignal(false);
    setMruOrder([]);
    setAttention(reconcile({}));
  }

  return {
    activeId,
    setActiveId,
    canvasMaximized,
    toggleCanvasMaximized,
    mruOrder,
    setMruOrder,
    markUnread,
    markBadgeAttention,
    clearBadgeAttention,
    isUnread,
    hasBadgeAttention,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
