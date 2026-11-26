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
 *  `canvasMaximized` moved INTO the owner at W7 TIER A — it parameterizes the
 *  VIEW OF this host's tiles, so it is per-host by THE RULE; the facade re-points
 *  it at `activeScope()?.view.canvasMaximized` like every other per-host fact.
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

  /** Whether the workspace is in fullscreen-one-tile mode — the ACTIVE host's
   *  per-host posture (born in `createViewState`, persisted per host so it survives
   *  reload). Floors the removal race to `false`, exactly like the view-selection
   *  reads above. */
  const canvasMaximized = (): boolean => view()?.canvasMaximized() ?? false;

  /** Canvas "pan to this tile" intent — see `canvas/useCanvasFocus.ts` for the
   *  consumer seam. `equals: false` so back-to-back requests for the same id
   *  still fire. Public reads only; the writer is private (external callers go
   *  through `useTerminalStore().activate(id)`). */
  // HOST-SCOPING: host-INDEPENDENT by design — a momentary write-and-consume
  // viewport command, not durable per-host state; nothing re-reads it across a switch.
  const [centerActiveRequest, setCenterActiveRequest] =
    createSignal<TerminalId | null>(null, { equals: false });

  /** Fire the "pan to this tile" impulse for the CURRENT host without touching
   *  the active selection or reporting to the server — the switch-in
   *  center-on-active path (a local viewport command, never a wrong-host RPC).
   *
   *  The tile is NAMED by the caller instead of read from `activeId()` here.
   *  Both kinds of caller need it that way: a store verb fires this in the same
   *  synchronous step that writes the selection, where the selection signal
   *  still reads its PRE-write value, and the canvas fires it from an effect,
   *  which is not a window to read reactive state in. The caller always knows
   *  the tile it means — the one it just activated, or the active tile its
   *  compute resolved. */
  function requestCenterActive(tileId: TerminalId): void {
    setCenterActiveRequest(tileId);
  }

  /** THE VISIT-TRAIL VERBS ARE READER/ACTOR PAIRS, like the store's landing
   *  verbs. Their one reactive read is the ACTIVE HOST's scope (`view()`); the
   *  owner half behind it is pure writes (the visit trail's updater-form
   *  setters). So the `plan…` half RESOLVES THE SCOPE — in a compute — and
   *  hands back a write-only actor for the effect phase, where that read would
   *  be STRICT_READ_UNTRACKED. An eager verb beside it is that plan, run, and
   *  exists only where an event handler (which may read freely) calls it.
   *
   *  Resolving the scope one phase earlier is the behaviour that is wanted:
   *  the trail the effect writes is the one its compute saw, so a host switch
   *  racing the write cannot land a departing host's cleanup on the new host's
   *  trail.
   *
   *  There is no SEED verb beside this one. A host's live MRU membership is
   *  derived from its census where it is read (`hostScope/createViewState`),
   *  so the trail carries gestures only: a visit, and a kill's forget. */
  const planForgetFromMru = (id: TerminalId): (() => void) => {
    const scope = view();
    return () => scope?.forgetFromMru(id);
  };

  const forgetFromMru = (id: TerminalId): void => planForgetFromMru(id)();

  function toggleCanvasMaximized() {
    view()?.setCanvasMaximized((prev) => !prev);
  }

  const isUnread = (id: TerminalId): boolean => view()?.isUnread(id) ?? false;

  /** Clear the ACTIVE host's selection record (handleCloseAll closes every tile
   *  on the active host). Other hosts' records are untouched. The owner's `reset`
   *  also drops this host's `canvasMaximized` posture back to tiled, matching the
   *  pre-per-host behavior. */
  function reset() {
    view()?.reset();
  }

  /** Does the ACTIVE host's derived boot pick already stand on this tile? The
   *  hydration seed asks before it writes the focus fact — see
   *  `hostScope/createBootPick`. Floors the removal race to `false` (a departing
   *  host's seed writes, and its write is the usual no-op). */
  const seedCovers = (id: TerminalId): boolean =>
    view()?.seedCovers(id) ?? false;

  /** Reader/actor pair, like the visit-trail verbs above: the hydration effect's
   *  COMPUTE resolves the scope, and the actor performs the covered seed's side
   *  effects (unread mark, visit trail, the host's active-terminal report). */
  const planNoteSeededActivation = (id: TerminalId): (() => void) => {
    const scope = view();
    return () => scope?.noteSeededActivation(id);
  };

  /** The ACTIVE host's derived auto-switch, taken once — see
   *  `hostScope/createViewState.takeAutoSwitch`. A departing host has no owner
   *  to have moved anything, so the removal race reads "nothing moved". */
  const takeAutoSwitch = (): TerminalId | null | undefined =>
    view()?.takeAutoSwitch();

  /** Its imperative half, plus the canvas pan the write verb used to carry. */
  const noteAutoSwitch = (id: TerminalId): void => {
    view()?.noteAutoSwitch(id);
    requestCenterActive(id);
  };
  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    canvasMaximized,
    toggleCanvasMaximized,
    mruOrder,
    forgetFromMru,
    planForgetFromMru,
    centerActiveRequest,
    requestCenterActive,
    isUnread,
    seedCovers,
    planNoteSeededActivation,
    takeAutoSwitch,
    noteAutoSwitch,
    reset,
  };
}

export type ViewState = ReturnType<typeof useViewState>;
