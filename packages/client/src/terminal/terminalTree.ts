/** Pure terminal-tree walks — root ancestor, flattened descendants, and the
 *  same descendants re-shaped into the true parent→child tree. The ONE place
 *  that resolves "who is the root" and "which ids hang under it". */

import type { TerminalId } from "kolu-common/surface";

/** Live parent edge for a terminal id.
 *  - `null` — id is present and has no parent (a root).
 *  - `TerminalId` — id is present and points at that parent.
 *  - `undefined` — id is absent from the census (dangling edge / not yet arrived). */
export type ParentEdge = (id: TerminalId) => TerminalId | null | undefined;

/** Containing canvas tile for a pane — the root of its parent chain, or the id
 *  itself when it is a root / cycle / orphan. */
export function containingTileOf(
  id: TerminalId,
  parentOf: ParentEdge,
): TerminalId {
  return rootAncestorOf(id, parentOf) ?? id;
}

/** Root ancestor of `id`, or `null` when the walk finds no root (a cycle, a
 *  dangling parentId, or a missing start id). */
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
 *  order. Cycle members and orphans are omitted from every group; roots never
 *  appear in their own group. */
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
 *  into the true parent→child tree the Dock indents. Siblings keep `flat`'s
 *  order. A pane whose parent is neither the root nor another pane in `flat`
 *  throws. */
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
