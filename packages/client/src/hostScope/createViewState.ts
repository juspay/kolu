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
 *  The camera moved OUT to a sibling owner member (`createCamera`) — it is no
 *  longer a `HostView` field. Host-INDEPENDENT view posture (`canvasMaximized`)
 *  and the momentary `centerActiveRequest` command stay APP-level (the facade
 *  `useViewState` still owns them) — they must NOT swap on a host switch. */

import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
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
  reset: () => void;
}

export function createViewState(host: HostKey): HostViewState {
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  const [mruOrder, setMru] = createSignal<TerminalId[]>([]);
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});

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
    void padiRpcOf(host)
      .surface.chrome.setActive({ id })
      .catch(() => {});
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
    setActiveId(null);
    setMru([]);
    setAttention(reconcile({}));
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
    reset,
  };
}
