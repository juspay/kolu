/** View state — per-browser-tab UI state.
 *  Which terminal is selected, which have unread completions, MRU switch
 *  history. Active terminal is reported to server for session snapshots
 *  and restored via useSessionRestore on reconnect.
 *  Terminal grid dimensions are per-instance — each xterm measures its
 *  own container via FitAddon.
 *
 *  HOST-SCOPING (shape B): the SELECTION facts — active tile, MRU order,
 *  per-tile attention, and the canvas CAMERA (pan/zoom) it was last viewed at —
 *  are PER HOST. Each host the tab has viewed keeps its own
 *  `HostView` record IN MEMORY, keyed by the canonical host string; switching the
 *  active host SWAPS which record every accessor reads/writes, so a host's focus +
 *  MRU + unread survive a switch-away and are restored verbatim on switch-back
 *  (the first visit seeds from the server's SavedSession via useSessionRestore;
 *  in-memory wins on subsequent switch-backs). Only `canvasMaximized` (a per-TAB
 *  localStorage view posture, not session state) and `centerActiveRequest` (a
 *  momentary viewport command) stay host-INDEPENDENT. */

import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { boolPref } from "./persistedPref";
import { activeHost, activePadiRpc } from "./wire";

type TerminalAttention = "unread" | "badge-only";

/** A canvas camera pose — the viewport's pan offset (canvas-space) and zoom.
 *  The LIVE camera lives in `canvas/viewport/useCanvasViewport.ts`'s module
 *  signals (that is where the #1308 rAF write-coalescing writes); this is the
 *  durable PER-HOST snapshot of it, saved/restored around a host switch. The
 *  type lives HERE, beside its per-host storage, so `useViewState` (view state)
 *  never takes a reverse dep on `canvas/` — the viewport imports the type
 *  DOWN-arrow instead (canvas → view state). */
export type Camera = { panX: number; panY: number; zoom: number };

/** One host's selection state — the active tile, its MRU order, per-tile
 *  attention, and the canvas camera it was last viewed at. Held in memory per
 *  host and swapped on switch. `camera` is `null` until the host has been
 *  viewed once (FIRST VISIT), which is the signal the switch-in center uses to
 *  decide "seed the camera on the active tile" vs. "restore the saved pose". */
type HostView = {
  activeId: TerminalId | null;
  mruOrder: TerminalId[];
  attention: Record<TerminalId, TerminalAttention>;
  camera: Camera | null;
};

const emptyHostView = (): HostView => ({
  activeId: null,
  mruOrder: [],
  attention: {},
  camera: null,
});

export function useViewState() {
  /** Per-host selection records, keyed by the canonical host string
   *  (`encodeHostKey`). `hosts[key]` is `undefined` until a host is first
   *  touched; reads floor to an empty view so a never-visited host is simply
   *  empty, not a crash. */
  const [hosts, setHosts] = createStore<Record<string, HostView>>({});
  const hostKey = () => encodeHostKey(activeHost());
  function ensureHost(k: string): void {
    if (!hosts[k]) setHosts(k, emptyHostView());
  }

  const activeId = () => hosts[hostKey()]?.activeId ?? null;
  const mruOrder = () => hosts[hostKey()]?.mruOrder ?? [];

  /** Whether the workspace is in fullscreen-one-tile mode. The active
   *  tile is always the one rendered fullscreen, so this is a pure mode
   *  flag. Persisted to localStorage so the posture survives reload —
   *  it's a per-tab view preference, not session state, so it lives
   *  alongside other view prefs (e.g. minimap-expanded), not in the
   *  server's SavedSession. */
  // HOST-SCOPING: host-INDEPENDENT by design — a per-TAB view posture (which tile
  // is fullscreen), not a per-host selection fact; it must NOT swap on host switch.
  // `boolPref` carries the strict `"true"`/`"false"` parse — the default
  // coercion read the stored string `"false"` as truthy, latching the
  // posture on once persisted.
  const [canvasMaximized, setCanvasMaximizedSignal] = boolPref({
    name: "kolu-canvas-maximized",
    fallback: false,
  });

  /** Canvas "pan to this tile" intent — see `canvas/useCanvasFocus.ts`
   *  for the consumer seam. `equals: false` so back-to-back requests for
   *  the same id still fire the listener. Public reads only; the writer
   *  is private — external callers go through `activate(id)` instead, so
   *  there is no two-call dance to forget. */
  // HOST-SCOPING: host-INDEPENDENT by design — a momentary write-and-consume
  // viewport command, not durable per-host state; nothing re-reads it across a switch.
  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  /** The single write path for activation of the CURRENT host — swaps its active
   *  tile, fronts its MRU, clears its unread, and reports it to that host's server
   *  session. IMPERATIVE (not a reactive `on(activeId)` effect) precisely so a pure
   *  host SWITCH — which only changes which record `activeId()` reads — fires NONE
   *  of these side effects: no wrong-host `chrome.setActive` write, no MRU churn.
   *  Only a real activation on the active host runs them. */
  function writeActive(id: TerminalId | null): void {
    const k = hostKey();
    ensureHost(k);
    setHosts(k, "activeId", id);
    if (id === null) return;
    setHosts(k, "mruOrder", (prev) => [id, ...prev.filter((x) => x !== id)]);
    if (hosts[k]?.attention[id] === "unread")
      setHosts(
        k,
        "attention",
        produce((a) => {
          delete a[id];
        }),
      );
    // Report the active terminal to the ACTIVE host for its session snapshot.
    void activePadiRpc.surface.chrome.setActive({ id }).catch(() => {});
  }

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
    writeActive(id);
    if (id !== null) setCenterActiveRequest(id);
  }

  /** Set the active terminal without panning the canvas. Reserve for
   *  callers that have a domain reason not to pan; use {@link activate}
   *  by default. */
  const setActiveSilently = writeActive;

  /** Fire the "pan to the active tile" impulse for the CURRENT host without
   *  touching the active selection or reporting anything to the server. This is
   *  the switch-in center-on-active path (B): a pure host SWITCH changes which
   *  record `activeId()` reads but runs none of `writeActive`'s side effects, so
   *  it never re-centers on its own. `centerActiveRequest` is a LOCAL viewport
   *  command — firing it is never a wrong-host `chrome.setActive` write. A
   *  no-op when the host has no active tile. */
  function requestCenterActive(): void {
    const id = activeId();
    if (id !== null) setCenterActiveRequest(id);
  }

  /** Read a host's saved camera pose (or `null` if the host has never been
   *  viewed). Keyed by the EXPLICIT `encodeHostKey` string — the switch seam
   *  restores the INCOMING host's pose, which is no longer `hostKey()` by the
   *  time the swap runs. */
  const readCamera = (k: string): Camera | null => hosts[k]?.camera ?? null;

  /** Save a host's camera pose. Keyed EXPLICITLY (see {@link readCamera}) so the
   *  switch seam can snapshot the OUTGOING host, which `hostKey()` no longer
   *  names once `activeHost()` has flipped. */
  function writeCamera(k: string, camera: Camera): void {
    ensureHost(k);
    setHosts(k, "camera", camera);
  }

  function setMruOrder(
    next: TerminalId[] | ((prev: TerminalId[]) => TerminalId[]),
  ): void {
    const k = hostKey();
    ensureHost(k);
    setHosts(
      k,
      "mruOrder",
      typeof next === "function" ? next(hosts[k]?.mruOrder ?? []) : next,
    );
  }

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
    const k = hostKey();
    ensureHost(k);
    setHosts(k, "attention", id, "unread");
  }

  function markBadgeAttention(id: TerminalId) {
    const k = hostKey();
    ensureHost(k);
    if (hosts[k]?.attention[id] !== "unread")
      setHosts(k, "attention", id, "badge-only");
  }

  function clearBadgeAttention() {
    const k = hostKey();
    if (!hosts[k]) return;
    setHosts(
      k,
      "attention",
      produce((s) => {
        for (const id of Object.keys(s) as TerminalId[]) {
          if (s[id] === "badge-only") delete s[id];
        }
      }),
    );
  }

  function isUnread(id: TerminalId): boolean {
    return hosts[hostKey()]?.attention[id] === "unread";
  }

  function hasBadgeAttention(id: TerminalId): boolean {
    return hosts[hostKey()]?.attention[id] !== undefined;
  }

  /** Clear the ACTIVE host's selection record (handleCloseAll closes every tile
   *  on the active host). Other hosts' records are untouched. `canvasMaximized`
   *  (per-tab posture) is reset too, matching the pre-per-host behavior. */
  function reset() {
    const k = hostKey();
    ensureHost(k);
    setHosts(k, reconcile(emptyHostView()));
    setCanvasMaximizedSignal(false);
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
    requestCenterActive,
    readCamera,
    writeCamera,
    markUnread,
    markBadgeAttention,
    clearBadgeAttention,
    isUnread,
    hasBadgeAttention,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
