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
 *  longer a `HostView` field. W7 TIER A pulled MORE per-host view facts in here:
 *  the fullscreen posture (`canvasMaximized`), the two dock filters
 *  (`activityWindow`, `showSleeping`), and the right-panel collapsed bit — each a
 *  VIEW OF this host's content, so each is per-host by THE RULE (see
 *  `canvas/canvasBoundaryGuard.test.ts`). Only the momentary `centerActiveRequest`
 *  command stays APP-level in the facade — a write-and-consume viewport impulse,
 *  never durable per-host state. The dock filters persist PER HOST in localStorage
 *  (a sticky preference must survive reload); the postures are in-memory (reload
 *  → tiled/inherit, matching the camera tier). */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal, type Setter } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { boolPref, persistedPref } from "../persistedPref";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  isActivityWindow,
} from "../terminal/activityWindow";
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
  // ── Per-host VIEW POSTURE + dock filters (W7 TIER A) ─────────────────
  /** Fullscreen-one-tile posture for THIS host. In-memory (reload resets to
   *  tiled — the camera tier), per-host so a switch shows each host's own
   *  posture. */
  canvasMaximized: Accessor<boolean>;
  setCanvasMaximized: Setter<boolean>;
  /** This host's dock activity-window filter — persisted per host under
   *  `kolu-activityWindow:<encoded host>` so a host's filter survives reload (a
   *  sticky dock preference, unlike the volatile camera/posture) without two
   *  hosts colliding on one global key. */
  activityWindow: Accessor<ActivityWindow>;
  setActivityWindow: Setter<ActivityWindow>;
  /** Whether THIS host's dock shows sleeping (☾) rows — persisted per host under
   *  `kolu-showSleeping:<encoded host>`, same rationale as `activityWindow`. */
  showSleeping: Accessor<boolean>;
  setShowSleeping: Setter<boolean>;
  /** This host's right-panel collapsed bit — `undefined` means "inherit the
   *  global preference" (the seed the facade reads on first sight); a set value
   *  is this host's in-memory override (reload re-inherits the global). */
  rightPanelCollapsed: Accessor<boolean | undefined>;
  setRightPanelCollapsed: Setter<boolean | undefined>;
  reset: () => void;
}

export function createViewState(host: HostKey): HostViewState {
  const [activeId, setActiveId] = createSignal<TerminalId | null>(null);
  const [mruOrder, setMru] = createSignal<TerminalId[]>([]);
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({});

  // The canonical host string — the per-host storage-key suffix + the map's
  // `codec.encode(host)`. Computed once per owner.
  const encoded = encodeHostKey(host);

  // View posture: in-memory per host (reload → tiled, matching the camera tier).
  const [canvasMaximized, setCanvasMaximized] = createSignal(false);

  // Dock filters: persisted PER HOST — a dock filter is a sticky preference (it
  // must survive reload), but keyed by host so two hosts don't share one filter.
  const [activityWindow, setActivityWindow] = persistedPref<ActivityWindow>({
    name: `kolu-activityWindow:${encoded}`,
    fallback: DEFAULT_ACTIVITY_WINDOW,
    parse: (raw) => {
      if (isActivityWindow(raw)) return raw;
      throw new Error(`unrecognized activity window: ${raw}`);
    },
  });
  const [showSleeping, setShowSleeping] = boolPref({
    name: `kolu-showSleeping:${encoded}`,
    fallback: true,
  });

  // Right-panel collapsed: in-memory per host. `undefined` = inherit the global
  // preference — the `useRightPanel` facade seeds the read with
  // `preferences().rightPanel.collapsed`, so a host's first sight matches the old
  // global bit and only diverges once the user toggles it on THAT host.
  const [rightPanelCollapsed, setRightPanelCollapsed] = createSignal<
    boolean | undefined
  >(undefined);

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
    setActiveId(null);
    setMru([]);
    setAttention(reconcile({}));
    // Closing every tile drops this host back to the tiled posture (matching the
    // pre-per-host behavior where `reset` cleared `canvasMaximized`). The dock
    // filters and the right-panel bit are sticky preferences, NOT selection state,
    // so a close-all leaves them untouched.
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
    activityWindow,
    setActivityWindow,
    showSleeping,
    setShowSleeping,
    rightPanelCollapsed,
    setRightPanelCollapsed,
    reset,
  };
}
