/** Terminal removal — the FULL cleanup, driven off the LIST not an event.
 *
 *  When a terminal leaves the list its whole tree/chrome must be reconciled:
 *  sub-terminals of a departing PARENT are promoted to top-level, a departing
 *  SUB switches/collapses its parent's sub-panel, and a departing TOP-LEVEL tile
 *  sheds its panels + MRU slot and hands focus to a survivor. On master this ran
 *  reliably because the `terminalExit` event won the race with the list update;
 *  now the list-removal DISPOSES that event's subscription (it is keyed to the
 *  live list — see useTerminalExits), so a natural exit usually loses the event.
 *  Deriving the cleanup from the LIST closes the race for every removal cause.
 *
 *  ONE cleanup body (`evictTerminal`), two callers:
 *    - the imperative close path (`removeAndAutoSwitch` in useTerminalCrud) —
 *      runs synchronously with metadata still present, reading the live
 *      parentId + top-level order;
 *    - the list-driven reconcile below — runs AFTER the departed terminal's
 *      metadata is gone, so it feeds `evictTerminal` a parentId + top-level
 *      order CAPTURED from the pre-removal snapshot.
 *  `createEvictionDedup` keeps a kill from evicting twice: the imperative path
 *  CLAIMS the id, and the reconcile skips (draining) a claimed id. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createMemo, on } from "solid-js";

/** Pick the tile that inherits focus when the active tile is removed: the
 *  survivor now occupying the removed tile's slot (its old index, clamped to the
 *  new last), or `null` when none remain. `survivors` is the top-level list
 *  WITHOUT the removed id and `removedIndex` is where it sat before it went. The
 *  ONE home for "which sibling does focus fall to" — both callers of
 *  `evictTerminal` reach it through here, so they can never diverge. A
 *  `removedIndex` of `-1` (the removed id was never top-level) yields `null`. */
export function pickAutoSwitchTarget(
  survivors: readonly TerminalId[],
  removedIndex: number,
): TerminalId | null {
  return survivors[Math.min(removedIndex, survivors.length - 1)] ?? null;
}

/** The side-effecting seams `evictTerminal` drives — the store, the sub-panel,
 *  the right-panel, the find-bar, and the promote RPC. Bundled so the cleanup
 *  body is a pure function of (ports, id, parentId, order): unit-testable with
 *  plain spies, and wired ONCE in useTerminalCrud. */
export interface TerminalEvictionPorts {
  /** Sub-terminal ids for a parent, read LIVE (list-driven). */
  getSubTerminalIds: (parentId: TerminalId) => readonly TerminalId[];
  activeId: () => TerminalId | null;
  /** Pan-and-activate a survivor (or `null`). */
  activate: (id: TerminalId | null) => void;
  /** Drop an id from the tile MRU. */
  dropFromMru: (id: TerminalId) => void;
  /** Promote a sub-terminal to top-level (server `setParent(id, null)`). */
  promoteToTopLevel: (subId: TerminalId) => void;
  subPanel: {
    collapse: (parentId: TerminalId) => void;
    activeSubTab: (parentId: TerminalId) => TerminalId | null;
    setActiveSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
    requestRefocus: (parentId: TerminalId) => void;
    remove: (id: TerminalId) => void;
  };
  removeRightPanel: (id: TerminalId) => void;
  removeSearch: (id: TerminalId) => void;
}

/** Reconcile the tree/chrome for a removed terminal. `parentId` is EXPLICIT (not
 *  read from metadata) so the list-driven caller can run this after the metadata
 *  is gone; `topLevelBefore` is the top-level order that STILL CONTAINS `id`, for
 *  byte-identical switch-target selection. Byte-for-byte the old
 *  `removeAndAutoSwitch` body, minus the metadata read. */
export function evictTerminal(
  ports: TerminalEvictionPorts,
  id: TerminalId,
  parentId: TerminalId | null,
  topLevelBefore: readonly TerminalId[],
) {
  if (parentId !== null) {
    // Sub-terminal: switch/collapse the parent's sub-panel; a sub is never the
    // active tile, so no focus auto-switch here.
    const subs = ports.getSubTerminalIds(parentId).filter((x) => x !== id);
    if (subs.length === 0) {
      ports.subPanel.collapse(parentId);
    } else {
      if (ports.subPanel.activeSubTab(parentId) === id) {
        ports.subPanel.setActiveSubTab(parentId, subs[0] ?? null);
      }
      // Re-grab focus for the remaining active sub-terminal: closing a tab via
      // its close button moves focus to that button, and the reactive focus
      // state is otherwise unchanged, so the edge-triggered focus effect can't
      // restore it (browser focus-after-removal is non-deterministic).
      ports.subPanel.requestRefocus(parentId);
    }
    return;
  }

  // Top-level tile — promote its sub-terminals to top-level, shed its chrome,
  // and auto-switch focus if it was active.
  for (const subId of ports.getSubTerminalIds(id))
    ports.promoteToTopLevel(subId);
  ports.subPanel.remove(id);
  ports.removeRightPanel(id);
  ports.removeSearch(id);
  ports.dropFromMru(id);
  if (ports.activeId() === id) {
    // `activate` pans the canvas to the survivor — without it the viewport would
    // stay centered on the just-removed tile.
    ports.activate(
      pickAutoSwitchTarget(
        topLevelBefore.filter((x) => x !== id),
        topLevelBefore.indexOf(id),
      ),
    );
  }
}

/** Dedup the two callers of `evictTerminal` so a kill can't evict twice. The
 *  imperative close path evicts synchronously and CLAIMS the id (only when a
 *  list-drop is actually coming — `willDrop`); the list-driven reconcile then
 *  skips (and drains) any claimed id, so the kill's later list-drop is a true
 *  no-op — no double `setParent`, no double switch. A claim is added only when a
 *  departure will follow, so it's always drained by that departure's reconcile —
 *  the claim set stays bounded to in-flight removals (no leak). */
export function createEvictionDedup(
  runEvict: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: readonly TerminalId[],
  ) => void,
) {
  const claimed = new Set<TerminalId>();
  return {
    evictImperatively(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      willDrop: boolean,
    ) {
      if (willDrop) claimed.add(id);
      runEvict(id, parentId, topLevelBefore);
    },
    evictDeparted(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
    ) {
      if (claimed.delete(id)) return; // already evicted by the imperative path
      runEvict(id, parentId, topLevelBefore);
    },
  };
}

/** Whether two parent-snapshots are identical — same ids, same order, same
 *  parentId each. The `equals` gate on the snapshot memo below, so a metadata
 *  change that touches neither membership nor any parentId (the common case) does
 *  not wake the reconcile. Order-sensitive to match `terminalIds`. */
function sameParentSnapshot(
  a: Map<TerminalId, TerminalId | null>,
  b: Map<TerminalId, TerminalId | null>,
): boolean {
  if (a.size !== b.size) return false;
  const bIter = b.entries();
  for (const [k, v] of a) {
    const next = bIter.next().value;
    if (next === undefined || next[0] !== k || next[1] !== v) return false;
  }
  return true;
}

export function useActiveReconcile(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** Live parentId for a listed id (`null` for top-level). */
  parentOf: (id: TerminalId) => TerminalId | null;
  /** The canonical ACTIVE-host key. The list is host-scoped (`terminalListSub`
   *  re-keys on switch), so a host SWITCH replaces the WHOLE list with a disjoint
   *  id space. Without this the reconcile would read every prior-host id as a mass
   *  departure and fire wrong-host `setParent`/auto-switch writes against the
   *  newly-active host. Carried in the snapshot so a switch RESETS the baseline
   *  (like the first run) instead of evicting the departed host's tiles. */
  activeHostKey: () => string;
  /** Run the full cleanup for a naturally-departed terminal (dedup-guarded). */
  evictDeparted: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: TerminalId[],
  ) => void;
  /** Whether the daemon is genuinely CONNECTED — i.e. the client is the lifecycle
   *  authority. When it is NOT (a supervised recycle/restart/degraded), departures
   *  are the server's doing (the drain empties the list) and are undone by restore,
   *  so the reconcile SUPPRESSES its authoritative promote-on-departure writes. */
  isDaemonConnected: () => boolean;
}) {
  // A live snapshot of every listed terminal's parentId, in key order — so a
  // DEPARTED terminal's tree relationship (parent? which parent?) survives its
  // removal, when its metadata is already gone. Rebuilt on any record change but
  // gated to parentId/membership changes (and host switch) by `equals` below. The
  // host rides ALONG so a switch is one atomic snapshot step, never seen as
  // departures of the prior host's tiles.
  const snapshot = createMemo<{
    host: string;
    map: Map<TerminalId, TerminalId | null>;
  }>(
    () => {
      const m = new Map<TerminalId, TerminalId | null>();
      for (const id of deps.rawList()) m.set(id, deps.parentOf(id));
      return { host: deps.activeHostKey(), map: m };
    },
    { host: "", map: new Map() },
    {
      equals: (a, b) => a.host === b.host && sameParentSnapshot(a.map, b.map),
    },
  );

  createEffect(
    on(snapshot, (currSnap, prevSnap) => {
      if (prevSnap === undefined) return; // first run — nothing has departed
      // Host SWITCH — the list re-keyed to a disjoint host. Advance the baseline
      // WITHOUT evicting the departed host's tiles (they didn't close; the tab just
      // looked away). Any wrong-host promote/auto-switch write is thus unspellable.
      if (currSnap.host !== prevSnap.host) return;
      const curr = currSnap.map;
      const prev = prevSnap.map;
      const departed: TerminalId[] = [];
      for (const id of prev.keys()) if (!curr.has(id)) departed.push(id);
      if (departed.length === 0) return; // a parentId change with no departure
      // SUPPRESS the eviction while the daemon is NOT connected (a supervised
      // recycle/restart/degraded). Then a departure is the server's own doing — a
      // `recycleKaval` holds `restarting` (published BEFORE the drain empties the
      // list) and restore undoes it — and the client is not the lifecycle
      // authority: promoting the split's subs here fires `chrome.setParent(sub,
      // null)` against a daemon that no longer has them (the "Failed to set parent"
      // toast), and a write that lands after park silently un-parents the parked
      // sub so the split restores orphaned. Sampled, not tracked: `on` runs this
      // callback untracked, so we read the current state without re-arming the
      // effect on a connectivity flip — and `prev` still advances to `curr`, so a
      // departure skipped here is never re-processed once reconnected. A real
      // user-close only ever happens while connected, where the cleanup runs as
      // before.
      if (!deps.isDaemonConnected()) return;
      // The pre-removal top-level order (still contains the departed ids), for
      // byte-identical switch-target selection.
      const topLevelBefore: TerminalId[] = [];
      for (const [id, parentId] of prev) {
        if (parentId === null) topLevelBefore.push(id);
      }
      for (const id of departed) {
        deps.evictDeparted(id, prev.get(id) ?? null, topLevelBefore);
      }
    }),
  );
}
