/** Adopt an externally-created split — the ARRIVAL mirror of useActiveReconcile.
 *
 *  A split created OUTSIDE the browser (`kolu create --parent`, another
 *  client, a future API) reaches the daemon via
 *  `lifecycle.create({placement: {kind: "child-of", parentId}})`
 *  and shows up on the terminals collection — but nothing runs the two
 *  BROWSER-LOCAL steps the manual split path does (`useTerminalCrud.
 *  handleCreateSubTerminal`): expand the parent's sub-panel and select the new
 *  tab. Without them the sub-panel keeps its prior state and the new sub's body
 *  never paints — its `visible` gate is `activeSubTab() === subId`, and no one
 *  set `activeSubTab`. This hook closes that gap by REACTING to the arrival on
 *  the list, so a split from ANY actor behaves like a manual one.
 *
 *  Expand-but-don't-steal: a new split ALWAYS expands the parent's panel (like a
 *  manual create), but becomes the ACTIVE tab only when the parent has no active
 *  split — an arrival never yanks the view off a split you're already working in.
 *  A plain `activeSubTab === null` check suffices because `evictTerminal` clears
 *  the active tab when a parent's last split departs (the reconcile), so the tab
 *  is null-or-live by invariant — never dangling at a gone sub.
 *
 *  Adopt only in a LIVE, seeded session. During initial load / restore /
 *  supervised recycle the host is not `seeded` and `useSessionRestore` owns the
 *  sub-panel tabs (it restores the persisted collapsed state and picks
 *  `subIds[0]`); adopting there would fight hydration. The restore `phase` is
 *  DELIBERATELY non-reactive (`createSessionRestore`), so it is SAMPLED, never
 *  tracked — and the baseline can't lean on reacting to the seed transition:
 *  a sub present before the host seeds lands in the memo's PREVIOUS snapshot on
 *  the next tick, so it is baseline (never a false arrival), and only a
 *  genuinely-new sub that appears WHILE seeded is adopted. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, on } from "solid-js";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { containingTileOf, type ParentEdge } from "./terminalTree";

/** The sub-panel seams a new split drives — read live, mutated to adopt. Bundled
 *  so the hook is a pure function of (ports, list, phase): unit-testable with
 *  plain spies, wired once in useTerminals. */
export interface SplitAdoptPorts {
  /** Expand the parent's sub-panel (idempotent) — run on every adopted split. */
  expandPanel: (parentId: TerminalId) => void;
  /** The parent's current active sub-tab (`null` when none is selected). Null-or-
   *  live by invariant — the reconcile clears it when the last split departs. */
  activeSubTab: (parentId: TerminalId) => TerminalId | null;
  /** Select a sub-tab — run only when the parent has no active split (don't steal
   *  from a split you're already working in). */
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId) => void;
}

export function useAdoptNewSplit(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** The store's live parent EDGE: `null` for a top-level tile, `undefined`
   *  when the id is absent from the census. Three-valued on purpose — the walk
   *  below must stop at a departed ancestor instead of climbing through it and
   *  expanding a dead tile's panel. */
  parentOf: ParentEdge;
  /** The canonical ACTIVE-host key. Carried in the snapshot so a host SWITCH
   *  rebaselines (its existing splits are not mass arrivals) — the same disjoint
   *  id-space concern useActiveReconcile guards. */
  activeHostKey: () => string;
  /** SAMPLED restore phase for the active host (non-reactive by design). */
  restorePhase: () => HydrationPhase;
  ports: SplitAdoptPorts;
}) {
  // A live snapshot of every SUB terminal's parentId (top-level ids excluded — a
  // sub-only projection, so `equals` fires only on a SUB change), in key order,
  // tagged with the active host. The shared factory owns the host-tag, seed, and
  // gate (sub membership/parent change or host switch) — one construction with the
  // reconcile sibling, differing only in this map projection.
  const snapshot = createHostScopedParentSnapshot<TerminalId>(
    deps.rawList,
    deps.activeHostKey,
    (ids) => {
      const m = new Map<TerminalId, TerminalId>();
      for (const id of ids) {
        const parentId = deps.parentOf(id);
        // Both non-sub answers skip: `null` is a top-level tile, `undefined` is
        // an id whose record has not arrived — neither is a split arrival.
        if (parentId != null) m.set(id, parentId);
      }
      return m;
    },
  );

  createEffect(
    on(snapshot, (curr, prev) => {
      // First run OR a host SWITCH — advance the baseline and adopt NONE: a fresh
      // host must not auto-open its existing splits. `prev` is framework-maintained
      // (SolidJS keeps the memo's prior value), so the switched-to host's subs land
      // in the baseline next tick for free — no manual accumulator to reset.
      if (prev === undefined || curr.host !== prev.host) return;
      // `on` runs this callback untracked, so the SAMPLED phase read (and the
      // ports' live reads below) add no dependency — the effect wakes only on a
      // snapshot change, exactly like the reconcile. Not seeded (load/restore/
      // recycle) → hydration owns the tabs; we skip, but `curr` still becomes next
      // tick's `prev`, so a sub seen while unseeded is baseline, never a deferred
      // false arrival.
      if (deps.restorePhase() !== "seeded") return;
      // Arrivals are curr − prev: a sub in the live map absent from last tick's.
      for (const [subId, parentId] of curr.map) {
        if (prev.map.has(subId)) continue;
        // Sub-panel chrome is keyed on the ROOT tile. A nested create
        // (`parentId` = a middle split) must expand that tile's panel, not a
        // middle node that has no canvas chrome of its own.
        const tileId = containingTileOf(parentId, deps.parentOf);
        deps.ports.expandPanel(tileId);
        // Don't-steal: select the arrival only when no split is currently active.
        // `activeSubTab` is null-or-live by invariant (evictTerminal clears it when
        // a tile's last split departs), so a plain null-check IS the liveness
        // test — an active tab is always a real split you're working in.
        if (deps.ports.activeSubTab(tileId) === null) {
          deps.ports.setActiveSubTab(tileId, subId);
        }
      }
    }),
  );
}
