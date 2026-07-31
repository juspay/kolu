/** `createViewState` — ONE host's per-host SELECTION state, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  This is the successor to `useViewState`'s `HostView` record + the `hosts`
 *  `createStore` hand-keyed by `encodeHostKey(activeHost())`. The enumeration
 *  (a record whose fields a new fact must be remembered into, keyed by hand at a
 *  swap seam) DIES: the owner IS the host, so these are just plain signals —
 *  per-host by construction. Focus (`focusedTerminalId`), MRU order, and per-tile
 *  attention are the ratified "cheap, client-owned" state (ids + order — keeping
 *  them across a switch-away is free); they survive a switch-away in this owner
 *  and are disposed only when the host leaves `padiMap.entries`.
 *
 *  The camera and the sticky per-host PREFERENCES moved OUT to sibling owner
 *  members (`createCamera`, `createHostPrefs`) — they are no longer `HostView`
 *  fields. What is left here is the SELECTION state — active tile,
 *  focus, MRU, attention — which a close-all `reset()` clears. That split is
 *  deliberate: everything left in this factory is reset-on-close-all, so `reset()` clears its WHOLE state with no
 *  "clear these but not those" allow/deny list (the enumeration hazard W7 kills).
 *  The sticky dock filters live in `createHostPrefs` precisely because
 *  they must SURVIVE a close-all. (The right-panel collapsed bit is neither here
 *  nor there: it travels with the TERMINAL via `TerminalMetadata.rightPanel`, not
 *  the host scope — the panel follows the terminal, #959.) Only the momentary
 *  `centerActiveRequest` command stays APP-level in the facade — a
 *  write-and-consume viewport impulse, never durable per-host state.
 *
 *  (The fullscreen posture that used to live here is GONE: focusing a tile is a
 *  camera move now, and the camera is its own per-host owner.) */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createMemo,
  createSelector,
  createSignal,
} from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  activeTileOf,
  type TerminalFocus,
  type TerminalPlacement,
} from "../terminal/focusedTerminal";
import { useVisitRecency } from "../terminal/visitRecency";
import { padiMap } from "../wire";

// A terminal that has drawn attention while unwatched, surfaced as a dock unread
// mark. (The former `"badge-only"` state drove the active-host OS badge; W5
// moved the badge to the cross-host urgency sum in `useAttention`, so unread
// is the only attention mark this per-host state carries now.)
type TerminalAttention = "unread";

export interface HostViewState {
  /** The one written focus fact: the terminal receiving keyboard input, whether
   *  it is a top-level tile or a split. */
  focusedTerminalId: Accessor<TerminalId | null>;
  /** The active top-level tile, folded from `focusedTerminalId` via parentId. */
  activeId: Accessor<TerminalId | null>;
  isFocused: (id: TerminalId) => boolean;
  isActiveTile: (id: TerminalId) => boolean;
  mruOrder: Accessor<TerminalId[]>;
  /** The single per-host focus write path. Active-tile side effects use the
   *  ancestor folded from this terminal. */
  writeFocus: (focus: TerminalFocus | null) => void;
  /** Seed empty host trail / reconcile live membership (order is seed-only). */
  reconcileLiveIds: (liveIds: readonly TerminalId[]) => void;
  /** Drop one terminal from the durable visit trail (kill path). */
  forgetFromMru: (id: TerminalId) => void;
  markUnread: (id: TerminalId) => void;
  isUnread: (id: TerminalId) => boolean;
  reset: () => void;
}

export function createViewState(
  host: HostKey,
  placementOf: (id: TerminalId) => TerminalPlacement,
): HostViewState {
  const [focus, setFocus] = createSignal<TerminalFocus | null>(null);
  const focusedTerminalId = createMemo(() => focus()?.id ?? null);
  const activeId = createMemo(() => activeTileOf(focus(), placementOf));
  const isFocused = createSelector(focusedTerminalId);
  const isActiveTile = createSelector(activeId);
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});
  // Cross-host visit trail — one client SOT for ⌘K Recent + Ctrl+Tab.
  const visits = useVisitRecency();

  // The canonical host string — the map's `codec.encode(host)`, used in the
  // active-terminal report's error message below. Computed once per owner.
  const encoded = encodeHostKey(host);

  // Host-filtered slice of the visit MRU (most-recent first). Replaces the old
  // per-host in-memory list so cycling order survives reloads.
  const mruOrder = createMemo(() => visits.mruForHost(host));

  function writeFocus(next: TerminalFocus | null): void {
    setFocus(next);
    const focusedId = next?.id ?? null;
    if (focusedId !== null && attention[focusedId] === "unread")
      setAttention(
        produce((a) => {
          delete a[focusedId];
        }),
      );
    const tileId = activeTileOf(next, placementOf);
    if (tileId === null) return;
    // THE activation choke point — canvas, dock, palette, Ctrl+Tab all land here.
    visits.noteVisit(host, tileId);
    // Report the active terminal to THIS owner's host for its session snapshot.
    // `writeFocus` only ever runs for the shown host (you focus a terminal on the
    // host you are viewing), so this fixed-host entry IS the active-host client.
    // A failure here leaves the server's saved-session snapshot momentarily stale
    // (the NEXT activation re-reports and self-heals), so this is best-effort — but
    // it must not vanish silently: log it so a persistent failure is visible rather
    // than a stale restore with no trace. No toast — this fires on every tile
    // activation, and a background bookkeeping report is not a user-facing action.
    void padiMap
      .entry(host)
      .procedures.chrome.setActive({ id: tileId })
      .catch((err: Error) => {
        console.error(
          `hostScope: failed to report active terminal ${tileId} to ${encoded}: ${err.message}`,
        );
      });
  }

  function reconcileLiveIds(liveIds: readonly TerminalId[]): void {
    // Empty host trail → seed with liveIds order; non-empty → membership only
    // (argument order is ignored for survivors). Kill uses forgetFromMru.
    visits.applyLiveIds(host, liveIds);
  }

  function forgetFromMru(id: TerminalId): void {
    visits.forgetVisit(host, id);
  }

  function markUnread(id: TerminalId): void {
    setAttention(id, "unread");
  }

  function isUnread(id: TerminalId): boolean {
    return attention[id] === "unread";
  }

  function reset(): void {
    // This factory owns ONLY reset-on-close-all state — the selection facts
    // (active tile, MRU, attention). The sticky per-host
    // PREFERENCES moved to `createHostPrefs`, so there is no "clear these but not
    // the prefs" allow/deny list to keep in sync: `reset` unconditionally clears
    // every signal this factory owns.
    setFocus(null);
    visits.clearHost(host);
    setAttention(reconcile({}));
  }

  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    mruOrder,
    writeFocus,
    reconcileLiveIds,
    forgetFromMru,
    markUnread,
    isUnread,
    reset,
  };
}
