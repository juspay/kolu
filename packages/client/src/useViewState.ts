/** View state — per-browser-tab UI state.
 *  Which terminal is selected, which have unread completions, MRU switch
 *  history. Active terminal is reported to server for session snapshots
 *  and restored via useSessionRestore on reconnect.
 *  Terminal grid dimensions are per-instance — each xterm measures its
 *  own container via FitAddon. */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, on } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { persistedPref } from "./persistedPref";
import { client } from "./wire";

type TerminalAttention = "unread" | "badge-only";

export function useViewState() {
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);

  /** Whether the workspace is in fullscreen-one-tile mode. The active
   *  tile is always the one rendered fullscreen, so this is a pure mode
   *  flag. Persisted to localStorage so the posture survives reload —
   *  it's a per-tab view preference, not session state, so it lives
   *  alongside other view prefs (e.g. minimap-expanded), not in the
   *  server's SavedSession. */
  const [canvasMaximized, setCanvasMaximizedSignal] = persistedPref<boolean>({
    name: "kolu-canvas-maximized",
    fallback: false,
    // Strict: the default coercion read the stored string `"false"` as
    // truthy, so the posture latched on once persisted. Only literal
    // `"true"`/`"false"` are valid; anything else throws and falls back.
    parse: (raw) => {
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new Error(`unrecognized maximized flag: ${raw}`);
    },
  });

  /** Terminals needing attention. `unread` drives in-app dots and badges;
   *  `badge-only` is for OS/PWA attention that should not show an in-app dot. */
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});

  const [mruOrder, setMruOrder] = createSignal<TerminalId[]>([]);

  /** Canvas "pan to this tile" intent — see `canvas/useCanvasFocus.ts`
   *  for the consumer seam. `equals: false` so back-to-back requests for
   *  the same id still fire the listener. Public reads only; the writer
   *  is private — external callers go through `activate(id)` instead, so
   *  there is no two-call dance to forget. */
  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  /** Make `id` the active terminal AND ask the canvas viewport to pan to
   *  it. The single public writer for system-driven activation — close
   *  auto-switch, post-create centering, palette / switcher / keyboard
   *  navigation, post-arrange recenter. Adding a new activation path
   *  means calling this; there is no separate "request centering" the
   *  caller can forget.
   *
   *  Use {@link setActiveSilently} only for the small set of callers
   *  where the tile is already on screen by construction (in-canvas tile
   *  click, focus events, title-bar buttons, mobile pager) or where there
   *  is no canvas to pan (mobile, session restore — initial-mount
   *  fallback handles centering). */
  function activate(id: TerminalId | null) {
    setActiveId(id);
    if (id !== null) setCenterActiveRequest(id);
  }

  /** Set the active terminal without panning the canvas. Reserve for
   *  callers that have a domain reason not to pan; use {@link activate}
   *  by default. */
  const setActiveSilently = setActiveId;
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
    activate,
    setActiveSilently,
    canvasMaximized,
    toggleCanvasMaximized,
    mruOrder,
    setMruOrder,
    centerActiveRequest,
    markUnread,
    markBadgeAttention,
    clearBadgeAttention,
    isUnread,
    hasBadgeAttention,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
