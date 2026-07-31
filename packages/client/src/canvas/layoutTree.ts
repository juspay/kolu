/** The tree IS the tiling — pure placement, no signals, no DOM.
 *
 *  Kolu's terminals form one tree (padi's `parentId`, arbitrary depth) and
 *  every terminal is a first-class tile. Where a tile sits is a pure function
 *  of that tree: a child tiles in the column to the right of its parent and
 *  siblings stack downward. There is no separate "split" or "sub-panel"
 *  concept and no *Autoarrange* command — auto-arrangement is the resting
 *  state, not an action, so a tile only leaves its derived spot when a human
 *  drags it.
 *
 *  A tile's manual pin IS `canvasLayout`: present ⇔ the user placed it there.
 *  `boxOf` reports those pins (plus roots the caller has already cascade-placed);
 *  everything else is derived here. Deriving rather than persisting is what
 *  makes the layout total — a terminal cannot exist without a place, which is
 *  the class of bug #2059 lived in (a record that matched no render rule simply
 *  vanished). */

import type { TileId } from "../tile/tileContent";
import type { TileLayout } from "./TileLayout";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";

/** Canvas-space gap between a parent's right edge and its children's column. */
export const CHILD_GUTTER = 64;
/** Canvas-space gap between stacked siblings. */
export const SIBLING_GUTTER = 32;

/** Compact size for a derived child tile. A child is usually a helper (a dev
 *  server, a lazygit) or a delegate agent that the eye should read as
 *  subordinate to its parent — the caller decides per id via `sizeOf`; this is
 *  the default that call site uses when it has no reason to say otherwise. */
export const CHILD_TILE_W = 560;
export const CHILD_TILE_H = 360;

/** The only shape this module needs from a terminal: its identity and its
 *  parent edge. Keeping the input this narrow is what lets the placement rule
 *  be unit-tested without a store, a record, or a clock. */
export interface TreeNode {
  id: TileId;
  parentId?: TileId;
}

/** Children indexed by parent, preserving the input order of `nodes` — the
 *  server's key order, which is what makes sibling stacking stable across
 *  re-renders (a set that hasn't changed derives the same boxes). */
export function childrenByParent(
  nodes: readonly TreeNode[],
): Map<TileId, TileId[]> {
  const present = new Set(nodes.map((n) => n.id));
  const byParent = new Map<TileId, TileId[]>();
  for (const n of nodes) {
    // An edge pointing outside the set (parent still loading, or already
    // gone) is NOT a child edge here — the node is treated as a root below,
    // so it still gets a place. Silently dropping it is exactly the
    // disappearing-terminal failure this design exists to make impossible.
    if (!n.parentId || !present.has(n.parentId)) continue;
    const siblings = byParent.get(n.parentId);
    if (siblings) siblings.push(n.id);
    else byParent.set(n.parentId, [n.id]);
  }
  return byParent;
}

/** Every descendant of `root`, depth-first, excluding `root` itself. Used to
 *  fit a whole subtree under the camera when a parent is focused. */
export function descendantIds(
  root: TileId,
  byParent: ReadonlyMap<TileId, TileId[]>,
): TileId[] {
  const out: TileId[] = [];
  const walk = (id: TileId) => {
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** Derive a box for every node that doesn't already have one.
 *
 *  `boxOf` returns a node's already-decided box — a manual pin (`canvasLayout`)
 *  or a root the caller cascade-placed. Nodes it answers for are left exactly
 *  where they are; their children still derive *relative to them*, so dragging
 *  a parent carries its subtree along without persisting a thing.
 *
 *  Walks parents before children (breadth-first from the roots) so a child is
 *  always placed against a box that is already known — including a parent whose
 *  own box was derived one level up. A node whose ancestry never resolves to a
 *  known box (an unpinned root — the caller's cascade owns those) is simply
 *  absent from the result; the caller composes the two halves, and the totality
 *  assert downstream is what proves the composition covered everyone. */
export function layoutTree(
  nodes: readonly TreeNode[],
  boxOf: (id: TileId) => TileLayout | undefined,
  sizeOf: (id: TileId) => { w: number; h: number } = () => ({
    w: CHILD_TILE_W,
    h: CHILD_TILE_H,
  }),
): Map<TileId, TileLayout> {
  const byParent = childrenByParent(nodes);
  const derived = new Map<TileId, TileLayout>();
  const resolved = (id: TileId): TileLayout | undefined =>
    boxOf(id) ?? derived.get(id);

  // Seed the walk with every node that already has a box — pins and
  // cascade-placed roots alike. Their children are what we can place next.
  const queue: TileId[] = nodes.map((n) => n.id).filter((id) => !!boxOf(id));
  const visited = new Set<TileId>(queue);

  while (queue.length > 0) {
    const parentId = queue.shift() as TileId;
    const parent = resolved(parentId);
    if (!parent) continue;
    let y = parent.y;
    for (const childId of byParent.get(parentId) ?? []) {
      // A pinned child keeps its pin, but still contributes its own height to
      // the stack so an unpinned sibling below it doesn't slide underneath.
      const pinned = boxOf(childId);
      const size = pinned ?? sizeOf(childId);
      if (!pinned) {
        derived.set(childId, {
          x: parent.x + parent.w + CHILD_GUTTER,
          y,
          w: size.w,
          h: size.h,
        });
      }
      y += size.h + SIBLING_GUTTER;
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  return derived;
}

/** The size a derived tile should take: a terminal running an agent reads as a
 *  peer and keeps the full default size; a plain shell (a dev server, a git UI)
 *  is a helper and takes the compact size. Exposed here beside the geometry so
 *  the canvas call site states the policy once. */
export function derivedTileSize(hasAgent: boolean): { w: number; h: number } {
  return hasAgent
    ? { w: DEFAULT_TILE_W, h: DEFAULT_TILE_H }
    : { w: CHILD_TILE_W, h: CHILD_TILE_H };
}
