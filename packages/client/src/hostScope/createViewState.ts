/** `createViewState` — ONE host's per-host SELECTION state, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  This is the successor to `useViewState`'s `HostView` record + the `hosts`
 *  `createStore` hand-keyed by `encodeHostKey(activeHost())`. The enumeration
 *  (a record whose fields a new fact must be remembered into, keyed by hand at a
 *  swap seam) DIES: the owner IS the host, so these are just plain signals —
 *  per-host by construction. Focus (`activeId`), MRU order, and per-tile
 *  attention are the ratified "cheap, client-owned" state (ids + order — keeping
 *  them across a switch-away is free); they survive a switch-away in this owner
 *  and are disposed only when the host leaves `padiMap.entries`.
 *
 *  The camera and the sticky per-host PREFERENCES moved OUT to sibling owner
 *  members (`createCamera`, `createHostPrefs`) — they are no longer `HostView`
 *  fields. What W7 TIER A DID leave here is the fullscreen posture
 *  (`canvasMaximized`) — a VIEW OF this host's content (per-host by THE RULE, see
 *  `canvas/canvasBoundaryGuard.test.ts`) that, like the selection facts, a
 *  close-all `reset()` clears. That split is deliberate: everything left in this
 *  factory is reset-on-close-all, so `reset()` clears its WHOLE state with no
 *  "clear these but not those" allow/deny list (the enumeration hazard W7 kills).
 *  The sticky filters/collapsed bit live in `createHostPrefs` precisely because
 *  they must SURVIVE a close-all. Only the momentary `centerActiveRequest` command
 *  stays APP-level in the facade — a write-and-consume viewport impulse, never
 *  durable per-host state. The posture is PERSISTED per host
 *  (`kolu-canvasMaximized:<host>`, restoring the pre-W7 reload-survival that the
 *  in-memory W7 signal had dropped) yet still reset-on-close-all — the one
 *  persisted fact this factory owns, since a fullscreen posture over zero tiles is
 *  meaningless; its key is evicted when the host leaves the pool. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal, type Setter } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { perHostBoolPref } from "../persistedPref";
import { padiRpcOf } from "../wire";

type TerminalAttention = "unread" | "badge-only";

export interface HostViewState {
  activeId: Accessor<TerminalId | null>;
  mruOrder: Accessor<TerminalId[]>;
  /** The single per-host activation write path: swaps the active tile, fronts the
   *  MRU, clears the tile's unread, and reports it to THIS host's server session.
   *  Named `writeActive` (the facade exposes it as `setActiveSilently`). */
  writeActive: (id: TerminalId | null) => void;
  setMruOrder: (
    next: TerminalId[] | ((prev: TerminalId[]) => TerminalId[]),
  ) => void;
  markUnread: (id: TerminalId) => void;
  markBadgeAttention: (id: TerminalId) => void;
  clearBadgeAttention: () => void;
  isUnread: (id: TerminalId) => boolean;
  hasBadgeAttention: (id: TerminalId) => boolean;
  // ── Per-host VIEW POSTURE (W7 TIER A) ────────────────────────────────
  /** Fullscreen-one-tile posture for THIS host. Persisted per host
   *  (`kolu-canvasMaximized:<host>`) so it survives reload — the pre-W7 behavior,
   *  restored — and per-host so a switch shows each host's own posture. Cleared by
   *  `reset()` (a close-all writes it back to tiled), so it is the one persisted
   *  fact this factory owns that a close-all still resets: the sticky dock filters
   *  in `createHostPrefs` deliberately SURVIVE a close-all, whereas a fullscreen
   *  posture over zero tiles is meaningless, so close-all floors it. */
  canvasMaximized: Accessor<boolean>;
  setCanvasMaximized: Setter<boolean>;
  reset: () => void;
}

export function createViewState(host: HostKey): HostViewState {
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  const [mruOrder, setMru] = createSignal<TerminalId[]>([]);
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});

  // The canonical host string — the map's `codec.encode(host)`, used in the
  // active-terminal report's error message below. Computed once per owner. (The
  // posture's per-host storage key is now composed inside `perHostBoolPref`.)
  const encoded = encodeHostKey(host);

  // View posture: persisted PER HOST so a host's fullscreen posture survives reload —
  // the pre-W7 behavior, restored — but keyed by host (unlike the pre-W7 GLOBAL
  // `kolu-canvas-maximized` flag) so two hosts don't collide. `perHostBoolPref` owns
  // the `<base>:<host>` key composition + evict-on-host-exit (see its docstring); this
  // factory just names its base. `reset()` still floors it to tiled on close-all (below).
  const [canvasMaximized, setCanvasMaximized] = perHostBoolPref({
    host,
    base: "kolu-canvasMaximized",
    fallback: false,
  });

  function writeActive(id: TerminalId | null): void {
    setActiveId(id);
    if (id === null) return;
    setMru((prev) => [id, ...prev.filter((x) => x !== id)]);
    if (attention[id] === "unread")
      setAttention(
        produce((a) => {
          delete a[id];
        }),
      );
    // Report the active terminal to THIS owner's host for its session snapshot.
    // `writeActive` only ever runs for the shown host (you activate a tile on the
    // host you are viewing), so `padiRpcOf(host)` is the active-host client.
    // A failure here leaves the server's saved-session snapshot momentarily stale
    // (the NEXT activation re-reports and self-heals), so this is best-effort — but
    // it must not vanish silently: log it so a persistent failure is visible rather
    // than a stale restore with no trace. No toast — this fires on every tile
    // activation, and a background bookkeeping report is not a user-facing action.
    void padiRpcOf(host)
      .surface.chrome.setActive({ id })
      .catch((err: Error) => {
        console.error(
          `hostScope: failed to report active terminal ${id} to ${encoded}: ${err.message}`,
        );
      });
  }

  function setMruOrder(
    next: TerminalId[] | ((prev: TerminalId[]) => TerminalId[]),
  ): void {
    setMru(typeof next === "function" ? next(mruOrder()) : next);
  }

  function markUnread(id: TerminalId): void {
    setAttention(id, "unread");
  }

  function markBadgeAttention(id: TerminalId): void {
    if (attention[id] !== "unread") setAttention(id, "badge-only");
  }

  function clearBadgeAttention(): void {
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

  function reset(): void {
    // This factory owns ONLY reset-on-close-all state — the selection facts
    // (active tile, MRU, attention) plus the maximized posture. The sticky per-host
    // PREFERENCES moved to `createHostPrefs`, so there is no "clear these but not
    // the prefs" allow/deny list to keep in sync: `reset` unconditionally clears
    // every signal this factory owns. Closing every tile drops this host back to
    // the tiled posture (matching the pre-per-host `reset` clearing `canvasMaximized`);
    // `setCanvasMaximized(false)` also writes `"false"` through the boolPref, so the
    // persisted posture is floored too — a reload after a close-all stays tiled.
    setActiveId(null);
    setMru([]);
    setAttention(reconcile({}));
    setCanvasMaximized(false);
  }

  return {
    activeId,
    mruOrder,
    writeActive,
    setMruOrder,
    markUnread,
    markBadgeAttention,
    clearBadgeAttention,
    isUnread,
    hasBadgeAttention,
    canvasMaximized,
    setCanvasMaximized,
    reset,
  };
}
