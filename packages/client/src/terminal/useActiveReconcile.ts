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
 *  ONE cleanup body (`planEviction`), two callers:
 *    - the imperative close path (`removeAndAutoSwitch` in useTerminalCrud) —
 *      runs synchronously with metadata still present, reading the live
 *      parentId + top-level order;
 *    - the list-driven reconcile below — runs AFTER the departed terminal's
 *      metadata is gone, so it feeds `planEviction` a parentId + top-level
 *      order CAPTURED from the pre-removal snapshot.
 *  `createEvictionDedup` keeps a kill from evicting twice: the imperative path
 *  CLAIMS the id, and the reconcile skips (draining) a claimed id. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, untrack } from "solid-js";
import { createHostScopedParentSnapshot } from "./parentSnapshot";
import { containingTileOf, type ParentEdge } from "./terminalTree";
import { type EvictionSubPanelPorts, planTileTabsRepair } from "./useSubPanel";

/** Pick the tile that inherits focus when the active tile is removed: the
 *  survivor now occupying the removed tile's slot (its old index in the FULL
 *  pre-removal order, clamped to the new last), or `null` when none remain. Owns
 *  the WHOLE focus-fallback policy from raw facts — `topLevelBefore` is the
 *  pre-removal top-level order (still containing `removedId`), `departing` is
 *  every id leaving this frame, and `removedId` is the tile being processed. It
 *  derives the survivor set itself (`topLevelBefore` minus `removedId` and
 *  everyone else departing), so no caller can drift the filter predicate or the
 *  filtered-list/unfiltered-index cross-argument invariant that carried the #1667
 *  bug. The removed tile is provably never its own successor regardless of what
 *  `departing` contains; a `removedId` that was never top-level (`indexOf` of
 *  `-1`) yields `null`. The ONE home for "which sibling does focus fall to" —
 *  both callers of `planEviction` reach it through here, so they can never
 *  diverge. */
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

/** The side-effecting seams {@link planEviction} drives — the store, the
 *  sub-panel, the right-panel, the find-bar, and the promote/rehome RPCs.
 *  Bundled so the cleanup body is a pure function of (ports, id, parentId,
 *  order): unit-testable with plain spies, and wired ONCE in useTerminalCrud.
 *
 *  The reading seams (`activeId`, `focusedTerminalId`, every `plan…`) are
 *  called in the PLAN phase and the writing ones in the actor, because the
 *  list-driven caller is a Solid effect, whose callback may not read. */
export interface TerminalEvictionPorts {
  activeId: () => TerminalId | null;
  focusedTerminalId: () => TerminalId | null;
  /** Reader half of "pan-and-activate a survivor (or `null`)". */
  planActivate: (id: TerminalId | null) => () => void;
  /** Drop an id from the tile MRU. */
  dropFromMru: (id: TerminalId) => void;
  /** Reader half of the promote: a sub-terminal takes its own tile (server
   *  `setParent(id, null)`), inheriting the panel posture of `fromTile` — the
   *  tile it is leaving, whose record the READ half consults. `fromTile` is
   *  passed EXPLICITLY rather than re-derived downstream: the list-driven
   *  caller runs after the departing tile has left the live census, so a live
   *  `containingTile` walk would dangle and answer "the child itself". */
  planPromoteToTopLevel: (
    subId: TerminalId,
    fromTile: TerminalId,
  ) => () => void;
  /** Re-home a surviving child under a still-live parent (`setParent`). */
  rehomeUnder: (subId: TerminalId, newParentId: TerminalId) => void;
  /** The panel's seams — the repair rule's own vocabulary plus the two verbs a
   *  removal drives and a repair does not (see `useSubPanel`). */
  subPanel: EvictionSubPanelPorts;
  removeRightPanel: (id: TerminalId) => void;
  removeSearch: (id: TerminalId) => void;
}

/** Pre-removal parent graph for a split eviction. The list-driven reconcile
 *  runs AFTER the departed id left the live census, so live root/flat walks
 *  see a dangling edge (grandchildren fall out of the root's pane set). The
 *  snapshot carries the intact tree: rehomes and remaining tabs are derived
 *  from it, not from the already-broken live index. */
export type RemovalGraph = {
  ids: readonly TerminalId[];
  parentOf: ParentEdge;
};

/** Reconcile the tree/chrome for a removed terminal. `parentId` is EXPLICIT (not
 *  read from metadata) so the list-driven caller can run this after the metadata
 *  is gone; `topLevelBefore` is the top-level order that STILL CONTAINS `id`, for
 *  byte-identical switch-target selection. `departing` is EVERY id leaving in this
 *  frame — just `id` for a single close, the whole batch for a list-driven
 *  multi-departure — so the auto-switch survivor set is `topLevelBefore` minus all
 *  of them: a frame that empties the top level clamps focus to null instead of a
 *  still-departing sibling. `removal` is the pre-removal parent graph — REQUIRED,
 *  and the only census this function reads. Both callers pass it: list-driven
 *  because live metadata already dropped `id` (grandchildren would look like
 *  orphans), imperative because it still has the intact census at kill time.
 *  There is deliberately no live-index fallback: a synthesized graph could only
 *  guess one hop, which is exactly the answer #2059 proved wrong — it would
 *  rehome a grandchild under the departing node's immediate parent instead of
 *  the highest surviving ancestor, and its census would omit live siblings.
 *
 *  A PLANNER, in two phases: every reactive read (the focused pane, the active
 *  tile, each panel verb's own reads) happens here, and the writes ride the
 *  function this returns — so the list-driven caller can run the plan in its
 *  effect's COMPUTE and the writes in the effect, where a read would be
 *  STRICT_READ_UNTRACKED. Hoisting the reads ahead of the writes is not a
 *  behaviour change: a Solid 2 write is staged, so a read after it on the same
 *  synchronous run already answered with the pre-write value. The ORDER of the
 *  writes themselves is unchanged — in particular a promote still runs before
 *  `removeRightPanel(id)`, so a promoted child still inherits a tile posture
 *  the record still holds. */
export function planEviction(
  ports: TerminalEvictionPorts,
  id: TerminalId,
  parentId: TerminalId | null,
  topLevelBefore: readonly TerminalId[],
  departing: ReadonlySet<TerminalId>,
  removal: RemovalGraph,
): () => void {
  /** The writes this eviction owes, in order. */
  const writes: (() => void)[] = [];
  const run = () => {
    for (const write of writes) write();
  };
  if (parentId !== null) {
    // A departing SPLIT owns panel state of its own — its tab, code mode,
    // per-mode selections, and a back/forward history stack — so it sheds that
    // state on the way out exactly as a departing tile does, in this ONE cleanup
    // body and before any branch below can return early. (Search state is
    // tile-only by construction: a split's leaf never opens the find bar.)
    writes.push(() => ports.removeRightPanel(id));
    const edge = removal.parentOf;
    const census = removal.ids;
    // Surviving containing tile: walk the full pre-removal ancestor chain and
    // take the HIGHEST still-live ancestor (canvas chrome keys on the root, not
    // a live middle). If none survive, promote to top-level.
    let dest: TerminalId | null = null;
    // The top of the departing chain — the tile a promoted child is leaving when
    // every ancestor departs. Read from the REMOVAL GRAPH, never the live store:
    // on the list-driven path the departing tile is already gone from the live
    // census (the whole reason this graph exists).
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
        if (!departing.has(cur)) dest = cur; // overwrite as we climb → highest
        const up = edge(cur);
        if (up === undefined || up === null) break;
        cur = up;
      }
    }
    const landing = dest;
    // True children of the departing node.
    for (const child of census) {
      if (child === id) continue;
      if (edge(child) !== id) continue;
      if (departing.has(child)) continue;
      if (landing === null)
        writes.push(ports.planPromoteToTopLevel(child, chainTop));
      else writes.push(() => ports.rehomeUnder(child, landing));
    }
    // Chrome repair only when a live root still owns the panel.
    if (landing === null) return run;
    const wasFocused = ports.focusedTerminalId() === id;
    const remaining = census.filter(
      (x) =>
        !departing.has(x) &&
        x !== id &&
        x !== landing &&
        containingTileOf(x, edge) === landing,
    );
    writes.push(
      planTileTabsRepair(ports.subPanel, landing, remaining, wasFocused),
    );
    if (remaining.length > 0) {
      // Closing through a tab's button moves DOM focus onto the button no matter
      // which pane owns the focus fact. Bump unconditionally: each pane's nonce
      // consumer is self-gated by its `focused` prop, so background panes ignore
      // it while the still-focused pane repairs DOM focus after removal.
      writes.push(() => ports.subPanel.requestRefocus(landing));
    }
    return run;
  }

  // Top-level tile — promote its TRUE one-hop children to top-level (each
  // keeps its own subtree intact), shed its chrome, and auto-switch focus if
  // it was active. Nested grandchildren ride with the promoted middles.
  //
  // The promote loop runs BEFORE `removeRightPanel(id)` below: a promoted child
  // inherits this tile's panel posture, which reads the tile's record — so the
  // record must still be there (the READ is this planner's, one phase earlier,
  // where the record is just as present).
  const oneHop = removal.ids.filter((x) => removal.parentOf(x) === id);
  for (const subId of oneHop) {
    if (departing.has(subId)) continue;
    writes.push(ports.planPromoteToTopLevel(subId, id));
  }
  writes.push(() => {
    ports.subPanel.removePanel(id);
    ports.removeRightPanel(id);
    ports.removeSearch(id);
    ports.dropFromMru(id);
  });
  if (ports.activeId() === id) {
    // `activate` pans the canvas to the survivor — without it the viewport would
    // stay centered on the just-removed tile.
    writes.push(
      ports.planActivate(pickAutoSwitchTarget(topLevelBefore, departing, id)),
    );
  }
  return run;
}

/** Dedup the two callers of {@link planEviction} so a kill can't evict twice.
 *  The imperative close path evicts synchronously and CLAIMS the id (only when
 *  a list-drop is actually coming — `willDrop`); the list-driven reconcile then
 *  skips (and drains) any claimed id, so the kill's later list-drop is a true
 *  no-op — no double `setParent`, no double switch. A claim is added only when a
 *  departure will follow, so it's always drained by that departure's reconcile —
 *  the claim set stays bounded to in-flight removals (no leak).
 *
 *  The CLAIM is spent in the write phase, not the plan phase: the list-driven
 *  caller plans in a compute that a later run may discard, and a claim consumed
 *  there would be gone with it. So the plan is built unconditionally (reads
 *  only) and the returned actor is what checks the claim — the same test, at
 *  the same moment, as before. */
export function createEvictionDedup(
  planEvict: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: readonly TerminalId[],
    departing: ReadonlySet<TerminalId>,
    removal: RemovalGraph,
  ) => () => void,
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
      // The departing set is this id PLUS every id already claimed but not yet
      // dropped. The imperative caller reads the LIVE top-level order, which only
      // shrinks when the server's list-drop lands — so a rapid second close still
      // sees the first (already-killed) tile in `topLevelBefore`; without excluding
      // it too, the auto-switch could re-focus that dead sibling (#1667 via the
      // imperative path), and the later list-drops can't self-heal (they
      // short-circuit on `claimed`). `claimed` is exactly that in-flight set.
      planEvict(
        id,
        parentId,
        topLevelBefore,
        new Set([id, ...claimed]),
        removal,
      )();
    },
    /** Reader half of the list-driven eviction: plan it in the reconcile's
     *  compute, run what comes back in its effect. */
    planEvictDeparted(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      departing: ReadonlySet<TerminalId>,
      removal: RemovalGraph,
    ): () => void {
      const evict = planEvict(id, parentId, topLevelBefore, departing, removal);
      return () => {
        if (claimed.delete(id)) return; // already evicted by the imperative path
        evict();
      };
    },
  };
}

export function useActiveReconcile(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** The store's live parent EDGE (`null` top-level, `undefined` absent) — the
   *  same one every other walk runs on. The snapshot below stores the absent
   *  case as `null`: an id in the list whose record has not arrived has no
   *  parent to reconcile yet. */
  parentOf: ParentEdge;
  /** The canonical ACTIVE-host key. The list is host-scoped (`terminalListSub`
   *  re-keys on switch), so a host SWITCH replaces the WHOLE list with a disjoint
   *  id space. Without this the reconcile would read every prior-host id as a mass
   *  departure and fire wrong-host `setParent`/auto-switch writes against the
   *  newly-active host. Carried in the snapshot so a switch RESETS the baseline
   *  (like the first run) instead of evicting the departed host's tiles. */
  activeHostKey: () => string;
  /** READER HALF of the full cleanup for a naturally-departed terminal
   *  (dedup-guarded): called from this reconcile's COMPUTE, it does the
   *  eviction's reads and hands back its writes, which the effect runs.
   *  `departing` is every id leaving in the same frame, so the auto-switch can
   *  clamp focus past all of them (never onto a still-departing sibling).
   *  `removal` is the pre-removal parent graph (the snapshot before this frame's
   *  departures), so nested rehome + remaining tabs don't walk a broken live
   *  census. */
  planEvictDeparted: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: TerminalId[],
    departing: ReadonlySet<TerminalId>,
    removal: RemovalGraph,
  ) => () => void;
  /** Whether the terminal list is a COMPLETE, authoritative census — i.e. the
   *  client is the lifecycle authority. When it is NOT (a supervised
   *  recycle/restart/degraded), departures are the server's doing (the drain empties
   *  the list) and are undone by restore, so the reconcile SUPPRESSES its
   *  authoritative promote-on-departure writes. */
  listIsAuthoritative: () => boolean;
}) {
  // A live snapshot of every listed terminal's parentId (ALL ids — top-level with
  // a `null` parent too, for byte-identical switch-target order), in key order — so
  // a DEPARTED terminal's tree relationship (parent? which parent?) survives its
  // removal, when its metadata is already gone. The shared factory gates it to
  // parentId/membership changes (and host switch), and rides the host ALONG so a
  // switch is one atomic snapshot step, never seen as departures of the prior
  // host's tiles.
  const snapshot = createHostScopedParentSnapshot<TerminalId | null>(
    deps.rawList,
    deps.activeHostKey,
    (ids) => {
      const m = new Map<TerminalId, TerminalId | null>();
      for (const id of ids) m.set(id, deps.parentOf(id) ?? null);
      return m;
    },
  );

  /** What this pass evicts, decided in the compute, acted on in the effect.
   *  The evictions are PLANNED here (the departed tiles' chrome, focus and
   *  tree facts are read in this compute) and travel as writes: the effect
   *  callback is a strict-read window, so nothing downstream may read. */
  interface ReconcilePass {
    readonly snap: { host: string; map: Map<TerminalId, TerminalId | null> };
    readonly evictions: readonly (() => void)[];
  }
  const nothingToDo = (snap: ReconcilePass["snap"]): ReconcilePass => ({
    snap,
    evictions: [],
  });
  createEffect(
    (prev?: ReconcilePass): ReconcilePass => {
      const currSnap = snapshot();
      const prevSnap = prev?.snap;
      if (prevSnap === undefined) return nothingToDo(currSnap); // first run
      // Host SWITCH — the list re-keyed to a disjoint host. Advance the baseline
      // WITHOUT evicting the departed host's tiles (they didn't close; the tab just
      // looked away). Any wrong-host promote/auto-switch write is thus unspellable.
      if (currSnap.host !== prevSnap.host) return nothingToDo(currSnap);
      const curr = currSnap.map;
      const prevMap = prevSnap.map;
      const departed: TerminalId[] = [];
      for (const id of prevMap.keys()) if (!curr.has(id)) departed.push(id);
      // a parentId change with no departure
      if (departed.length === 0) return nothingToDo(currSnap);
      // SUPPRESS the eviction while the list is NOT an authoritative census (a
      // supervised recycle/restart/degraded). Then a departure is the server's own
      // doing — a `recycleKaval` holds `restarting` (published BEFORE the drain
      // empties the list) and restore undoes it — and the client is not the
      // lifecycle authority: promoting the split's subs here fires
      // `chrome.setParent(sub, null)` against a daemon that no longer has them (the
      // "Failed to set parent" toast), and a write that lands after park silently
      // un-parents the parked sub so the split restores orphaned. SAMPLED
      // (untracked): the pass must not re-arm on an authority flip — and the
      // baseline still advances to `curr`, so a departure skipped here is never
      // re-processed once the list is authoritative again. A real user-close only
      // ever happens while the list is a complete census, where the cleanup runs
      // as before.
      if (!untrack(deps.listIsAuthoritative)) return nothingToDo(currSnap);
      const topLevelBefore: TerminalId[] = [];
      for (const [id, parentId] of prevMap) {
        if (parentId === null) topLevelBefore.push(id);
      }
      // Pre-removal parent graph — the intact tree before this frame's
      // departures. Live metadata already dropped departed ids; nested rehome
      // must not walk a dangling edge (grandchildren would fall out of the
      // root's pane set).
      const removal: RemovalGraph = {
        ids: [...prevMap.keys()],
        parentOf: (x) => {
          if (!prevMap.has(x)) return undefined;
          return prevMap.get(x) ?? null;
        },
      };
      // The whole departing set for THIS frame — so the per-tile auto-switch
      // clamps focus past every leaving tile at once. Without it a batch that
      // empties the top level lands focus on a sibling that is itself
      // departing.
      const departing = new Set(departed);
      return {
        snap: currSnap,
        // SAMPLED (untracked): each plan reads the departing tile's chrome,
        // the focused pane and the active tile as they stand at the departure
        // — the same reads the cleanup used to do in the (untracked) effect
        // phase. The LIST is what wakes this reconcile; a focus or a tab
        // moving on its own is not a departure and must not re-arm it.
        evictions: untrack(() =>
          departed.map((id) =>
            deps.planEvictDeparted(
              id,
              prevMap.get(id) ?? null,
              topLevelBefore,
              departing,
              removal,
            ),
          ),
        ),
      };
    },
    (pass) => {
      for (const evict of pass.evictions) evict();
    },
  );
}
