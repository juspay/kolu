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
 *  One member stays HOST-INDEPENDENT (it must NOT swap on a host switch), so it
 *  remains an app-level signal in this facade rather than owner state:
 *  `centerActiveRequest` (a momentary write-and-consume viewport command).
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

/** A canvas camera pose — the viewport's pan offset (canvas-space) and zoom.
 *  Owned per host by `hostScope/createCamera`; the type lives here (beside the
 *  view facade) so `canvas/` imports it DOWN-arrow (canvas → view state) rather
 *  than the reverse. */
export type Camera = { panX: number; panY: number; zoom: number };

export function useViewState() {
  // The active host's view slice, or `undefined` during the removal race.
  const view = () => activeScope()?.view;

  const focusedTerminalId = () => view()?.focusedTerminalId() ?? null;
  const activeId = () => view()?.activeId() ?? null;
  const isFocused = (id: TerminalId): boolean => view()?.isFocused(id) ?? false;
  const isActiveTile = (id: TerminalId): boolean =>
    view()?.isActiveTile(id) ?? false;
  const mruOrder = () => view()?.mruOrder() ?? [];

  /** Canvas "pan to this tile" intent — see `canvas/useCanvasFocus.ts` for the
   *  consumer seam. `equals: false` so back-to-back requests for the same id
   *  still fire. Public reads only; the writer is private (external callers go
   *  through `useTerminalStore().activate(id)`). */
  // HOST-SCOPING: host-INDEPENDENT by design — a momentary write-and-consume
  // viewport command, not durable per-host state; nothing re-reads it across a switch.
  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  /** Fire the "pan to the active tile" impulse for the CURRENT host without
   *  touching the active selection or reporting to the server — the switch-in
   *  center-on-active path (a local viewport command, never a wrong-host RPC). */
  function requestCenterActive(): void {
    const id = activeId();
    if (id !== null) setCenterActiveRequest(id);
  }

  const reconcileLiveIds = (liveIds: readonly TerminalId[]): void =>
    view()?.reconcileLiveIds(liveIds);

  const forgetFromMru = (id: TerminalId): void => view()?.forgetFromMru(id);

  const markUnread = (id: TerminalId) => view()?.markUnread(id);
  const isUnread = (id: TerminalId): boolean => view()?.isUnread(id) ?? false;

  /** Clear the ACTIVE host's selection record (handleCloseAll closes every tile
   *  on the active host). Other hosts' records are untouched. Other hosts' records are untouched. */
  function reset() {
    view()?.reset();
  }

  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    mruOrder,
    reconcileLiveIds,
    forgetFromMru,
    centerActiveRequest,
    requestCenterActive,
    markUnread,
    isUnread,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
