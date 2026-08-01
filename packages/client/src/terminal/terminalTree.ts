/** Pure terminal-tree walks — root ancestor, flattened descendants, and the
 *  same descendants re-shaped into the true parent→child tree.
 *
 *  The canvas paints a tile's splits as a flat tab strip of every descendant
 *  under that tile's root; the Dock paints the same panes as an indented tree.
 *  These helpers are the ONE place that resolves "who is the root" and "which
 *  ids hang under it", so canvas and Dock never re-derive the walk.
 *
 *  MEMBERSHIP IS ONE FACT, SHAPE IS THE VIEW. `paneTreeOf` re-shapes the very
 *  array `descendantsByRoot` produced — it never re-reads the census — so a
 *  pane the canvas paints and a pane the Dock lists are the same set by
 *  construction, cycles and orphans included. A surface that walked
 *  `parentId` itself could (and did) cover less than the other: the Dock's
 *  one-hop walk silently dropped every split of a split once padi allowed
 *  depth (#2059), and the terminal was reachable from no surface at all. */

import type { TerminalId } from "kolu-common/surface";

/** Live parent edge for a terminal id.
 *  - `null` — id is present and has no parent (a root).
 *  - `TerminalId` — id is present and points at that parent.
 *  - `undefined` — id is absent from the census (dangling edge / not yet arrived). */
export type ParentEdge = (id: TerminalId) => TerminalId | null | undefined;

/** Containing canvas tile for a pane — the root of its parent chain, or the
 *  id itself when it is a root / cycle / orphan (no resolvable root). The ONE
 *  answer to "which top-level tile owns this pane" for focus, panel chrome,
 *  deep links, and port jumps. */
export function containingTileOf(
  id: TerminalId,
  parentOf: ParentEdge,
): TerminalId {
  return rootAncestorOf(id, parentOf) ?? id;
}

/** Root ancestor of `id`, or `null` when the walk finds no root (a cycle, or a
 *  dangling parentId whose target is missing). A missing start id is also
 *  `null`. Callers that must never hide a terminal treat `null` as "paint this
 *  id as a top-level tile". */
export function rootAncestorOf(
  id: TerminalId,
  parentOf: ParentEdge,
): TerminalId | null {
  const seen = new Set<TerminalId>();
  let cur = id;
  for (;;) {
    if (seen.has(cur)) return null;
    seen.add(cur);
    const parent = parentOf(cur);
    if (parent === undefined) return null;
    if (parent === null) return cur;
    cur = parent;
  }
}

/** Group every non-root terminal under its root ancestor, preserving `ids`
 *  order (server Map insertion order — tab order and Cmd-cycling depend on it).
 *
 *  Cycle members and orphans (no resolvable root) are omitted from every group;
 *  they are painted as top-level tiles by the caller's `terminalIds` filter
 *  instead. Roots themselves never appear in their own group. */
export function descendantsByRoot(
  ids: readonly TerminalId[],
  parentOf: ParentEdge,
): Map<TerminalId, TerminalId[]> {
  const memo = new Map<TerminalId, TerminalId | null>();
  const resolve = (id: TerminalId): TerminalId | null => {
    if (memo.has(id)) return memo.get(id) ?? null;
    const path: TerminalId[] = [];
    const pathSet = new Set<TerminalId>();
    let cur = id;
    for (;;) {
      if (memo.has(cur)) {
        const root = memo.get(cur) ?? null;
        for (const p of path) memo.set(p, root);
        return root;
      }
      // O(1) membership via a path set — unbounded depth is legal, so a long
      // chain first seen from its deep end must not re-scan path[] per hop.
      if (pathSet.has(cur)) {
        for (const p of path) memo.set(p, null);
        memo.set(cur, null);
        return null;
      }
      path.push(cur);
      pathSet.add(cur);
      const parent = parentOf(cur);
      if (parent === undefined) {
        for (const p of path) memo.set(p, null);
        return null;
      }
      if (parent === null) {
        for (const p of path) memo.set(p, cur);
        return cur;
      }
      cur = parent;
    }
  };

  const byRoot = new Map<TerminalId, TerminalId[]>();
  for (const id of ids) {
    const parent = parentOf(id);
    if (parent === null || parent === undefined) continue;
    const root = resolve(id);
    if (root === null || root === id) continue;
    const list = byRoot.get(root);
    if (list) list.push(id);
    else byRoot.set(root, [id]);
  }
  return byRoot;
}

/** One pane in the true tree — a split, plus the splits made from IT. */
export type PaneNode = {
  id: TerminalId;
  children: readonly PaneNode[];
};

/** Re-shape ONE root's flat descendant list (from {@link descendantsByRoot})
 *  into the true parent→child tree the Dock indents.
 *
 *  This is a re-shaping, not a second walk: every id in `flat` lands in the
 *  tree exactly once, so no surface can enumerate fewer panes than another —
 *  the failure that hid a split of a split from the Dock. Siblings keep
 *  `flat`'s order (server order), which the Dock then re-sorts by urgency and
 *  the canvas keeps as tab order.
 *
 *  Every ancestor of an accepted descendant is itself accepted (`resolve` only
 *  returns a root when every hop up the chain was present), so a pane whose
 *  parent is neither the root nor another pane in `flat` cannot occur — it
 *  throws rather than quietly re-homing under the root, which is exactly the
 *  silent coverage gap this module exists to make impossible. */
export function paneTreeOf(
  root: TerminalId,
  flat: readonly TerminalId[],
  parentOf: ParentEdge,
): PaneNode[] {
  const children = new Map<TerminalId, PaneNode[]>([[root, []]]);
  for (const id of flat) children.set(id, []);
  const top = children.get(root);
  if (!top) throw new Error(`paneTreeOf: no child list for root ${root}`);
  for (const id of flat) {
    const parent = parentOf(id);
    const siblings = parent == null ? undefined : children.get(parent);
    if (!siblings) {
      throw new Error(
        `paneTreeOf: pane ${id} under root ${root} has no parent in the tile`,
      );
    }
    const kids = children.get(id);
    if (!kids) throw new Error(`paneTreeOf: no child list for pane ${id}`);
    siblings.push({ id, children: kids });
  }
  return top;
}
