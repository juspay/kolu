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
import { type Accessor, createEffect, on } from "solid-js";
import { createHostScopedParentSnapshot } from "./parentSnapshot";

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
 *  both callers of `evictTerminal` reach it through here, so they can never
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

/** The side-effecting seams `evictTerminal` drives — the store, the sub-panel,
 *  the right-panel, the find-bar, and the promote RPC. Bundled so the cleanup
 *  body is a pure function of (ports, id, parentId, order): unit-testable with
 *  plain spies, and wired ONCE in useTerminalCrud. */
export interface TerminalEvictionPorts {
  /** Sub-terminal ids for a parent, read LIVE (list-driven). */
  getSubTerminalIds: (parentId: TerminalId) => readonly TerminalId[];
  activeId: () => TerminalId | null;
  focusedTerminalId: () => TerminalId | null;
  /** Pan-and-activate a survivor (or `null`). */
  activate: (id: TerminalId | null) => void;
  /** Drop an id from the tile MRU. */
  dropFromMru: (id: TerminalId) => void;
  /** Promote a sub-terminal to top-level (server `setParent(id, null)`). */
  promoteToTopLevel: (subId: TerminalId) => void;
  subPanel: {
    collapse: (parentId: TerminalId) => void;
    collapseChrome: (parentId: TerminalId) => void;
    activeSubTab: (parentId: TerminalId) => TerminalId | null;
    setActiveSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
    selectSubTab: (parentId: TerminalId, subId: TerminalId | null) => void;
    requestRefocus: (parentId: TerminalId) => void;
    remove: (id: TerminalId) => void;
  };
  removeRightPanel: (id: TerminalId) => void;
  removeSearch: (id: TerminalId) => void;
}

/** Reconcile the tree/chrome for a removed terminal. `parentId` is EXPLICIT (not
 *  read from metadata) so the list-driven caller can run this after the metadata
 *  is gone; `topLevelBefore` is the top-level order that STILL CONTAINS `id`, for
 *  byte-identical switch-target selection. `departing` is EVERY id leaving in this
 *  frame — just `id` for a single close, the whole batch for a list-driven
 *  multi-departure — so the auto-switch survivor set is `topLevelBefore` minus all
 *  of them: a frame that empties the top level clamps focus to null instead of a
 *  still-departing sibling. */
export function evictTerminal(
  ports: TerminalEvictionPorts,
  id: TerminalId,
  parentId: TerminalId | null,
  topLevelBefore: readonly TerminalId[],
  departing: ReadonlySet<TerminalId>,
) {
  if (parentId !== null) {
    // Sub-terminal: always repair the parent's remembered chrome, but move DOM
    // and keyboard focus only when the departing sub actually held it. A
    // background split exit must not steal focus from the tile being used.
    const wasFocused = ports.focusedTerminalId() === id;
    const subs = ports.getSubTerminalIds(parentId).filter((x) => x !== id);
    if (subs.length === 0) {
      if (wasFocused) ports.subPanel.collapse(parentId);
      else ports.subPanel.collapseChrome(parentId);
      // Clear the active tab too: the parent's last split is gone, so `activeSubTab`
      // must not dangle at a departed sub. Keeping the invariant "`activeSubTab` is
      // null or a LIVE sub of this parent" global lets consumers trust a plain
      // null-check for "no active split" instead of each re-deriving liveness —
      // both the adopt don't-steal guard (useAdoptNewSplit) and restore's hydration
      // clamp (useSessionRestore) exist only to compensate for this dangling.
      ports.subPanel.setActiveSubTab(parentId, null);
    } else {
      if (ports.subPanel.activeSubTab(parentId) === id) {
        const replacement = subs[0] ?? null;
        if (wasFocused) ports.subPanel.selectSubTab(parentId, replacement);
        else ports.subPanel.setActiveSubTab(parentId, replacement);
      }
      // Closing through a tab's button moves DOM focus onto the button no matter
      // which pane owns the focus fact. Bump unconditionally: each pane's nonce
      // consumer is self-gated by its `focused` prop, so background panes ignore
      // it while the still-focused pane repairs DOM focus after removal.
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
    ports.activate(pickAutoSwitchTarget(topLevelBefore, departing, id));
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
    departing: ReadonlySet<TerminalId>,
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
      // The departing set is this id PLUS every id already claimed but not yet
      // dropped. The imperative caller reads the LIVE top-level order, which only
      // shrinks when the server's list-drop lands — so a rapid second close still
      // sees the first (already-killed) tile in `topLevelBefore`; without excluding
      // it too, the auto-switch could re-focus that dead sibling (#1667 via the
      // imperative path), and the later list-drops can't self-heal (they
      // short-circuit on `claimed`). `claimed` is exactly that in-flight set.
      runEvict(id, parentId, topLevelBefore, new Set([id, ...claimed]));
    },
    evictDeparted(
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      departing: ReadonlySet<TerminalId>,
    ) {
      if (claimed.delete(id)) return; // already evicted by the imperative path
      runEvict(id, parentId, topLevelBefore, departing);
    },
  };
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
  /** Run the full cleanup for a naturally-departed terminal (dedup-guarded).
   *  `departing` is every id leaving in the same frame, so the auto-switch can
   *  clamp focus past all of them (never onto a still-departing sibling). */
  evictDeparted: (
    id: TerminalId,
    parentId: TerminalId | null,
    topLevelBefore: TerminalId[],
    departing: ReadonlySet<TerminalId>,
  ) => void;
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
      for (const id of ids) m.set(id, deps.parentOf(id));
      return m;
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
      // SUPPRESS the eviction while the list is NOT an authoritative census (a
      // supervised recycle/restart/degraded). Then a departure is the server's own
      // doing — a `recycleKaval` holds `restarting` (published BEFORE the drain
      // empties the list) and restore undoes it — and the client is not the
      // lifecycle authority: promoting the split's subs here fires
      // `chrome.setParent(sub, null)` against a daemon that no longer has them (the
      // "Failed to set parent" toast), and a write that lands after park silently
      // un-parents the parked sub so the split restores orphaned. Sampled, not
      // tracked: `on` runs this callback untracked, so we read the current state
      // without re-arming the effect on an authority flip — and `prev` still
      // advances to `curr`, so a departure skipped here is never re-processed once
      // the list is authoritative again. A real user-close only ever happens while
      // the list is a complete census, where the cleanup runs as before.
      if (!deps.listIsAuthoritative()) return;
      // The pre-removal top-level order (still contains the departed ids), for
      // byte-identical switch-target selection.
      const topLevelBefore: TerminalId[] = [];
      for (const [id, parentId] of prev) {
        if (parentId === null) topLevelBefore.push(id);
      }
      // The whole departing set for THIS frame — so the per-tile auto-switch
      // clamps focus past every leaving tile at once. Without it a batch that
      // empties the top level lands focus on a sibling that is itself departing.
      const departing = new Set(departed);
      for (const id of departed) {
        deps.evictDeparted(id, prev.get(id) ?? null, topLevelBefore, departing);
      }
    }),
  );
}
