/** Pure terminal-tree walks — root ancestor and flattened descendants.
 *
 *  The canvas paints a tile's splits as a flat tab strip of every descendant
 *  under that tile's root; the Dock keeps the true one-hop parent→child edges.
 *  These helpers are the ONE place that resolves "who is the root" and "which
 *  ids hang under it", so canvas and Dock never re-derive the walk. */

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
    let cur = id;
    for (;;) {
      if (memo.has(cur)) {
        const root = memo.get(cur) ?? null;
        for (const p of path) memo.set(p, root);
        return root;
      }
      if (path.includes(cur)) {
        for (const p of path) memo.set(p, null);
        memo.set(cur, null);
        return null;
      }
      path.push(cur);
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
