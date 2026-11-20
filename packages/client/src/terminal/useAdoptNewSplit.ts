/** Adopt an externally-created split — the ARRIVAL mirror of useActiveReconcile.
 *
 *  A split created outside the browser arrives on the terminals collection with
 *  none of the browser-local steps the manual split path runs, so this hook
 *  reacts to the arrival: seed the split's panel tab, expand the parent's
 *  sub-panel, and select the new tab only when the parent has no active split.
 *  Adopts only in a LIVE, seeded session — otherwise `useSessionRestore` owns
 *  the sub-panel tabs. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, on } from "solid-js";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { containingTileOf, type ParentEdge } from "./terminalTree";

/** The sub-panel seams a new split drives — read live, mutated to adopt. */
export interface SplitAdoptPorts {
  /** Expand the parent's sub-panel (idempotent) — run on every adopted split. */
  expandPanel: (parentId: TerminalId) => void;
  /** The parent's current active sub-tab (`null` when none is selected). */
  activeSubTab: (parentId: TerminalId) => TerminalId | null;
  /** Select a sub-tab. */
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId) => void;
  /** Give the new split the panel tab of the terminal it is a child of. A no-op
   *  when the split already carries panel state. */
  seedSplitTab: (subId: TerminalId, parentId: TerminalId) => void;
}

export function useAdoptNewSplit(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** The store's live parent EDGE: `null` for a top-level tile, `undefined`
   *  when the id is absent from the census. */
  parentOf: ParentEdge;
  /** The canonical ACTIVE-host key, carried in the snapshot so a host switch
   *  rebaselines. */
  activeHostKey: () => string;
  /** SAMPLED restore phase for the active host (non-reactive by design). */
  restorePhase: () => HydrationPhase;
  ports: SplitAdoptPorts;
}) {
  const snapshot = createHostScopedParentSnapshot<TerminalId>(
    deps.rawList,
    deps.activeHostKey,
    (ids) => {
      const m = new Map<TerminalId, TerminalId>();
      for (const id of ids) {
        const parentId = deps.parentOf(id);
        if (parentId != null) m.set(id, parentId);
      }
      return m;
    },
  );

  createEffect(
    on(snapshot, (curr, prev) => {
      if (prev === undefined || curr.host !== prev.host) return;
      if (deps.restorePhase() !== "seeded") return;
      for (const [subId, parentId] of curr.map) {
        if (prev.map.has(subId)) continue;
        const tileId = containingTileOf(parentId, deps.parentOf);
        deps.ports.seedSplitTab(subId, parentId);
        deps.ports.expandPanel(tileId);
        if (deps.ports.activeSubTab(tileId) === null) {
          deps.ports.setActiveSubTab(tileId, subId);
        }
      }
    }),
  );
}
