/** View state — the per-browser-tab WINDOW onto the active host's owned view.
 *
 *  This is the FACADE the ~35 `useTerminalStore` consumers still read as
 *  `store.activeId()` / `store.activate(id)` / … . W7 emptied it out: the
 *  per-host SELECTION facts (active tile, MRU order, per-tile attention) no
 *  longer live in a `HostView` record hand-keyed by `encodeHostKey(activeHost())`
 *  — they live in the per-host `scopedByEntry` owner (`hostScope/createViewState`),
 *  and this facade reads the ACTIVE host's slice through `hostScopes.active()`.
 *  The enumeration (the `HostView` record + `ensureHost` + the swap seam) is GONE;
 *  a new per-host fact is a plain signal inside `createViewState`, per-host by
 *  construction, never a field to remember here.
 *
 *  Two members stay HOST-INDEPENDENT (they must NOT swap on a host switch), so
 *  they remain app-level signals in this facade rather than owner state:
 *  `canvasMaximized` (a per-TAB view posture) and `centerActiveRequest` (a
 *  momentary viewport command).
 *
 *  Removal-race flooring: `hostScopes.active()` is `undefined` for one tick when
 *  the active host is removed from the pool (the `wire.ts` membership reconcile
 *  re-points `activeHost` to LOCAL right after). Every per-host read floors to
 *  the empty value (`?? null` / `?? []` / `?? false`), exactly as the old
 *  `hosts[hostKey()] ?? empty` did — a never-visited or just-departed host reads
 *  empty, never a crash. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { activeScope } from "./hostScope/hostScopes";
import { boolPref } from "./persistedPref";

/** A canvas camera pose — the viewport's pan offset (canvas-space) and zoom.
 *  Owned per host by `hostScope/createCamera`; the type lives here (beside the
 *  view facade) so `canvas/` imports it DOWN-arrow (canvas → view state) rather
 *  than the reverse. */
export type Camera = { panX: number; panY: number; zoom: number };

export function useViewState() {
  // The active host's view slice, or `undefined` during the removal race.
  const view = () => activeScope()?.view;

  const activeId = () => view()?.activeId() ?? null;
  const mruOrder = () => view()?.mruOrder() ?? [];

  /** Whether the workspace is in fullscreen-one-tile mode. */
  // HOST-SCOPING: host-INDEPENDENT by design — a per-TAB view posture (which tile
  // is fullscreen), not a per-host selection fact; it must NOT swap on host switch.
  // `boolPref` carries the strict `"true"`/`"false"` parse — the default coercion
  // read the stored string `"false"` as truthy, latching the posture on once persisted.
  const [canvasMaximized, setCanvasMaximizedSignal] = boolPref({
    name: "kolu-canvas-maximized",
    fallback: false,
  });

  /** Canvas "pan to this tile" intent — see `canvas/useCanvasFocus.ts` for the
   *  consumer seam. `equals: false` so back-to-back requests for the same id
   *  still fire. Public reads only; the writer is private (external callers go
   *  through `activate(id)`). */
  // HOST-SCOPING: host-INDEPENDENT by design — a momentary write-and-consume
  // viewport command, not durable per-host state; nothing re-reads it across a switch.
  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  /** Make `id` the active terminal AND ask the canvas viewport to pan to it.
   *  The single public writer for system-driven activation. `writeActive` (in
   *  the owner) is imperative — a pure host SWITCH re-keys `activeId()` without
   *  running it, so a switch never fires a wrong-host `chrome.setActive`. */
  function activate(id: TerminalId | null) {
    view()?.writeActive(id);
    if (id !== null) setCenterActiveRequest(id);
  }

  /** Set the active terminal without panning the canvas. */
  const setActiveSilently = (id: TerminalId | null) => view()?.writeActive(id);

  /** Fire the "pan to the active tile" impulse for the CURRENT host without
   *  touching the active selection or reporting to the server — the switch-in
   *  center-on-active path (a local viewport command, never a wrong-host RPC). */
  function requestCenterActive(): void {
    const id = activeId();
    if (id !== null) setCenterActiveRequest(id);
  }

  const setMruOrder = (
    next: TerminalId[] | ((prev: TerminalId[]) => TerminalId[]),
  ): void => view()?.setMruOrder(next);

  function toggleCanvasMaximized() {
    setCanvasMaximizedSignal((prev) => !prev);
  }

  const markUnread = (id: TerminalId) => view()?.markUnread(id);
  const markBadgeAttention = (id: TerminalId) => view()?.markBadgeAttention(id);
  const clearBadgeAttention = () => view()?.clearBadgeAttention();
  const isUnread = (id: TerminalId): boolean => view()?.isUnread(id) ?? false;
  const hasBadgeAttention = (id: TerminalId): boolean =>
    view()?.hasBadgeAttention(id) ?? false;

  /** Clear the ACTIVE host's selection record (handleCloseAll closes every tile
   *  on the active host). Other hosts' records are untouched. `canvasMaximized`
   *  (per-tab posture) is reset too, matching the pre-per-host behavior. */
  function reset() {
    view()?.reset();
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
    markUnread,
    markBadgeAttention,
    clearBadgeAttention,
    isUnread,
    hasBadgeAttention,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
