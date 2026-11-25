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
 *  It is also the ONE place that sees every new split, so the new split's panel
 *  tab is seeded here too (`seedSplitTab`) — only this funnel covers an
 *  agent-created, `kolu create --parent`, or MCP `lifecycle_create {child-of}`
 *  split.
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
import { type Accessor, createEffect, onSettled, untrack } from "solid-js";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { containingTileOf, type ParentEdge } from "./terminalTree";

/** The sub-panel seams a new split drives — read live, mutated to adopt. Bundled
 *  so the hook is a pure function of (ports, list, phase): unit-testable with
 *  plain spies, wired once in useTerminals. */
export interface SplitAdoptPorts {
  /** Reader half of "expand the parent's sub-panel" (idempotent) — run on every
   *  adopted split. Two phases because the adoption is decided in an effect:
   *  the plan reads the tile's saved split, the actor writes the new one. */
  planExpandPanel: (parentId: TerminalId) => () => void;
  /** The parent's current active sub-tab (`null` when none is selected). Null-or-
   *  live by invariant — the reconcile clears it when the last split departs. */
  activeSubTab: (parentId: TerminalId) => TerminalId | null;
  /** Select a sub-tab — run only when the parent has no active split (don't steal
   *  from a split you're already working in). Writes only. */
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId) => void;
  /** Give the new split the panel tab of the terminal it is a child of, so an
   *  externally-created split does not flip the panel from Code to Inspector when
   *  you click into it. A no-op when the split already carries panel state (the
   *  browser create path seeds synchronously; a creator may have passed one).
   *  CURRIED on the parent — the right panel's own shape — so the read of the
   *  source pane happens in the plan and the seeding write in the actor. */
  seedSplitTab: (parentId: TerminalId) => (subId: TerminalId) => void;
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

  /** One split to adopt, decided in the compute and acted on in the effect.
   *  Every read the adoption needs — the root tile walk, the tile's active tab,
   *  the tile's saved split, the source pane's panel record — happens in the
   *  compute; what travels is the two WRITES, because an effect callback is a
   *  strict-read window. */
  interface Adoption {
    readonly subId: TerminalId;
    readonly tileId: TerminalId;
    /** Seed the arrival's panel tab from the pane it is a split of. */
    readonly seed: (subId: TerminalId) => void;
    /** Open the root tile's panel. */
    readonly expand: () => void;
    readonly takeFocus: boolean;
  }
  interface AdoptPass {
    readonly snap: { host: string; map: Map<TerminalId, TerminalId> };
    readonly adopt: readonly Adoption[];
  }
  createEffect(
    (prev?: AdoptPass): AdoptPass => {
      const curr = snapshot();
      const prevSnap = prev?.snap;
      // First run OR a host SWITCH — advance the baseline and adopt NONE: a fresh
      // host must not auto-open its existing splits. The baseline is the pass's
      // own previous value, so the switched-to host's subs land in it next tick
      // for free — no manual accumulator to reset.
      if (prevSnap === undefined || curr.host !== prevSnap.host)
        return { snap: curr, adopt: [] };
      // Not seeded (load/restore/recycle) → hydration owns the tabs; we skip, but
      // `curr` still becomes next tick's baseline, so a sub seen while unseeded is
      // baseline, never a deferred false arrival. SAMPLED (untracked): a phase
      // flip alone must not adopt anything — only a snapshot change may.
      if (untrack(deps.restorePhase) !== "seeded")
        return { snap: curr, adopt: [] };
      // Arrivals are curr − prev: a sub in the live map absent from last tick's.
      const adopt: Adoption[] = [];
      for (const [subId, parentId] of curr.map) {
        if (prevSnap.map.has(subId)) continue;
        adopt.push(
          untrack(() => {
            // Sub-panel chrome is keyed on the ROOT tile. A nested create
            // (`parentId` = a middle split) must expand that tile's panel, not a
            // middle node that has no canvas chrome of its own. The tree walk and
            // the tab read are SAMPLES of the current state — the snapshot is
            // what wakes this, exactly as the retired `on(snapshot, …)` form had
            // it.
            const tileId = containingTileOf(parentId, deps.parentOf);
            // Don't-steal: select the arrival only when no split is currently
            // active. `activeSubTab` is null-or-live by invariant (evictTerminal
            // clears it when a tile's last split departs), so a plain null-check
            // IS the liveness test — an active tab is always a real split you're
            // working in.
            return {
              subId,
              tileId,
              seed: deps.ports.seedSplitTab(parentId),
              expand: deps.ports.planExpandPanel(tileId),
              takeFocus: deps.ports.activeSubTab(tileId) === null,
            };
          }),
        );
      }
      return { snap: curr, adopt };
    },
    ({ adopt }) => {
      for (const { subId, tileId, seed, expand, takeFocus } of adopt) {
        // The seed's APPLIER reads the panel's own per-terminal state, and
        // this is an effect callback (a strict-read window), so it rides
        // `onSettled` — which is not one. It is ordered against nothing here:
        // the panel tab it seeds is a different store from the tile's split
        // chrome the two writes below touch.
        onSettled(() => {
          seed(subId);
        });
        expand();
        if (takeFocus) deps.ports.setActiveSubTab(tileId, subId);
      }
    },
  );
}
