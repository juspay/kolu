/** Terminal removal — the FULL cleanup, driven off the LIST not an event.
 *
 *  ONE cleanup body (`evictTerminal`), two callers: the imperative close path
 *  (`removeAndAutoSwitch` in useTerminalCrud), which runs with metadata still
 *  present, and the list-driven reconcile below, which runs after it is gone and
 *  feeds a pre-removal snapshot. `createEvictionDedup` keeps a kill from
 *  evicting twice. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, on } from "solid-js";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { containingTileOf, type ParentEdge } from "./terminalTree";
import { type EvictionSubPanelPorts, repairTileTabs } from "./useSubPanel";

/** Pick the tile that inherits focus when the active tile is removed: the
 *  survivor now occupying the removed tile's slot (its old index in
 *  `topLevelBefore`, clamped to the new last), or `null` when none remain.
 *  `departing` is every id leaving this frame. */
export function pickAutoSwitchTarget(
  topLevelBefore: readonly TerminalId[],
  departing: ReadonlySet<TerminalId>,
  removedId: TerminalId,
): TerminalId | null {
  const survivors = topLevelBefore.filter(
    (x) => x !== removedId && !departing.has(x),
  );
  return (
    survivors[
      Math.min(topLevelBefore.indexOf(removedId), survivors.length - 1)
    ] ?? null
  );
}

/** The side-effecting seams `evictTerminal` drives, wired ONCE in
 *  useTerminalCrud. */
export interface TerminalEvictionPorts {
  activeId: () => TerminalId | null;
  focusedTerminalId: () => TerminalId | null;
  /** Pan-and-activate a survivor (or `null`). */
  activate: (id: TerminalId | null) => void;
  /** Drop an id from the tile MRU. */
  dropFromMru: (id: TerminalId) => void;
  /** Promote a sub-terminal to top-level (server `setParent(id, null)`), giving
   *  it `fromTile` — the tile it is leaving — so the promoted tile can inherit
   *  that tile's panel posture. */
  promoteToTopLevel: (subId: TerminalId, fromTile: TerminalId) => void;
  /** Re-home a surviving child under a still-live parent (`setParent`). */
  rehomeUnder: (subId: TerminalId, newParentId: TerminalId) => void;
  /** The panel's seams (see `useSubPanel`). */
  subPanel: EvictionSubPanelPorts;
  removeRightPanel: (id: TerminalId) => void;
  removeSearch: (id: TerminalId) => void;
}

/** Pre-removal parent graph for a split eviction: the intact tree, from which
 *  rehomes and remaining tabs are derived. */
export type RemovalGraph = {
  ids: readonly TerminalId[];
  parentOf: ParentEdge;
};

/** Reconcile the tree/chrome for a removed terminal. `parentId` is EXPLICIT so
 *  the list-driven caller can run after the metadata is gone; `topLevelBefore`
 *  is the order that STILL CONTAINS `id`; `departing` is every id leaving in
 *  this frame; `removal` is the pre-removal parent graph and the only census
 *  this function reads. */
export function evictTerminal(
  ports: TerminalEvictionPorts,
  id: TerminalId,
  parentId: TerminalId | null,
  topLevelBefore: readonly TerminalId[],
  departing: ReadonlySet<TerminalId>,
  removal: RemovalGraph,
) {
  if (parentId !== null) {
    ports.removeRightPanel(id);
    const edge = removal.parentOf;
    const census = removal.ids;
    let dest: TerminalId | null = null;
    let chainTop: TerminalId = parentId;
    {
      let cur: TerminalId | null = parentId;
      const seen = new Set<TerminalId>();
      while (cur !== null) {
        if (seen.has(cur)) {
          dest = null;
          break;
        }
        seen.add(cur);
        chainTop = cur;
        if (!departing.has(cur)) dest = cur;
        const up = edge(cur);
        if (up === undefined || up === null) break;
        cur = up;
      }
    }
    for (const child of census) {
      if (child === id) continue;
      if (edge(child) !== id) continue;
      if (departing.has(child)) continue;
      if (dest === null) ports.promoteToTopLevel(child, chainTop);
      else ports.rehomeUnder(child, dest);
    }
    if (dest === null) return;
    const wasFocused = ports.focusedTerminalId() === id;
    const remaining = census.filter(
      (x) =>
        !departing.has(x) &&
        x !== id &&
        x !== dest &&
        containingTileOf(x, edge) === dest,
    );
    repairTileTabs(ports.subPanel, dest, remaining, wasFocused);
    if (remaining.length > 0) {
      ports.subPanel.requestRefocus(dest);
    }
    return;
  }

  const oneHop = removal.ids.filter((x) => removal.parentOf(x) === id);
  for (const subId of oneHop) {
    if (departing.has(subId)) continue;
    ports.promoteToTopLevel(subId, id);
  }
  ports.subPanel.removePanel(id);
  ports.removeRightPanel(id);
  ports.removeSearch(id);
  ports.dropFromMru(id);
  if (ports.activeId() === id) {
    ports.activate(pickAutoSwitchTarget(topLevelBefore, departing, id));
  }
}

/** Dedup the two callers of `evictTerminal` so a kill can't evict twice: the
 *  imperative path CLAIMS the id (only when a list-drop is coming — `willDrop`)
 *  and the list-driven reconcile skips and drains a claimed id. */
export function createEvictionDedup(
  runEvict: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: readonly TerminalId[],
    departing: ReadonlySet<TerminalId>,
    removal: RemovalGraph,
  ) => void,
) {
  const claimed = new Set<TerminalId>();
  return {
    evictImperatively(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      willDrop: boolean,
      removal: RemovalGraph,
    ) {
      if (willDrop) claimed.add(id);
      runEvict(
        id,
        parentId,
        topLevelBefore,
        new Set([id, ...claimed]),
        removal,
      );
    },
    evictDeparted(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      departing: ReadonlySet<TerminalId>,
      removal: RemovalGraph,
    ) {
      if (claimed.delete(id)) return;
      runEvict(id, parentId, topLevelBefore, departing, removal);
    },
  };
}

export function useActiveReconcile(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** The store's live parent EDGE (`null` top-level, `undefined` absent). The
   *  snapshot below stores the absent case as `null`. */
  parentOf: ParentEdge;
  /** The canonical ACTIVE-host key, carried in the snapshot so a host switch
   *  resets the baseline instead of reading a disjoint id space as departures. */
  activeHostKey: () => string;
  /** Run the full cleanup for a naturally-departed terminal (dedup-guarded).
   *  `departing` is every id leaving in the same frame; `removal` is the
   *  pre-removal parent graph. */
  evictDeparted: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: TerminalId[],
    departing: ReadonlySet<TerminalId>,
    removal: RemovalGraph,
  ) => void;
  /** Whether the terminal list is a COMPLETE, authoritative census. When it is
   *  not, departures are the server's doing and the reconcile suppresses its
   *  promote-on-departure writes. */
  listIsAuthoritative: () => boolean;
}) {
  const snapshot = createHostScopedParentSnapshot<TerminalId | null>(
    deps.rawList,
    deps.activeHostKey,
    (ids) => {
      const m = new Map<TerminalId, TerminalId | null>();
      for (const id of ids) m.set(id, deps.parentOf(id) ?? null);
      return m;
    },
  );

  createEffect(
    on(snapshot, (currSnap, prevSnap) => {
      if (prevSnap === undefined) return;
      if (currSnap.host !== prevSnap.host) return;
      const curr = currSnap.map;
      const prev = prevSnap.map;
      const departed: TerminalId[] = [];
      for (const id of prev.keys()) if (!curr.has(id)) departed.push(id);
      if (departed.length === 0) return;
      if (!deps.listIsAuthoritative()) return;
      const topLevelBefore: TerminalId[] = [];
      for (const [id, parentId] of prev) {
        if (parentId === null) topLevelBefore.push(id);
      }
      const departing = new Set(departed);
      const removal: RemovalGraph = {
        ids: [...prev.keys()],
        parentOf: (x) => {
          if (!prev.has(x)) return undefined;
          return prev.get(x) ?? null;
        },
      };
      for (const id of departed) {
        deps.evictDeparted(
          id,
          prev.get(id) ?? null,
          topLevelBefore,
          departing,
          removal,
        );
      }
    }),
  );
}
