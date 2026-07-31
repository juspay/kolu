import { describe, expect, it } from "vitest";
import type { TileId } from "../tile/tileContent";
import {
  CHILD_GUTTER,
  CHILD_TILE_H,
  CHILD_TILE_W,
  childrenByParent,
  descendantIds,
  layoutTree,
  SIBLING_GUTTER,
  type TreeNode,
} from "./layoutTree";
import type { TileLayout } from "./TileLayout";

const id = (s: string) => s as TileId;
const ROOT_BOX: TileLayout = { x: 100, y: 200, w: 800, h: 540 };

/** `boxOf` for a fixture: only the listed ids have a known box. */
const boxes =
  (map: Record<string, TileLayout>) =>
  (i: TileId): TileLayout | undefined =>
    map[i as string];

describe("layoutTree", () => {
  const nodes = (...pairs: [string, string?][]): TreeNode[] =>
    pairs.map(([i, p]) => ({ id: id(i), parentId: p ? id(p) : undefined }));

  it("places a child in the column to the right of its parent", () => {
    const derived = layoutTree(
      nodes(["root"], ["child", "root"]),
      boxes({ root: ROOT_BOX }),
    );
    expect(derived.get(id("child"))).toEqual({
      x: ROOT_BOX.x + ROOT_BOX.w + CHILD_GUTTER,
      y: ROOT_BOX.y,
      w: CHILD_TILE_W,
      h: CHILD_TILE_H,
    });
  });

  it("stacks siblings downward in input order", () => {
    const derived = layoutTree(
      nodes(["root"], ["a", "root"], ["b", "root"]),
      boxes({ root: ROOT_BOX }),
    );
    expect(derived.get(id("a"))?.y).toBe(ROOT_BOX.y);
    expect(derived.get(id("b"))?.y).toBe(
      ROOT_BOX.y + CHILD_TILE_H + SIBLING_GUTTER,
    );
    // Same column — siblings differ only in y.
    expect(derived.get(id("b"))?.x).toBe(derived.get(id("a"))?.x);
  });

  it("places a grandchild — the #2059 case that used to render nowhere", () => {
    const derived = layoutTree(
      nodes(["root"], ["child", "root"], ["grandchild", "child"]),
      boxes({ root: ROOT_BOX }),
    );
    const child = derived.get(id("child"));
    expect(child).toBeDefined();
    expect(derived.get(id("grandchild"))).toEqual({
      x: (child as TileLayout).x + CHILD_TILE_W + CHILD_GUTTER,
      y: (child as TileLayout).y,
      w: CHILD_TILE_W,
      h: CHILD_TILE_H,
    });
  });

  it("is total over depth — every descendant of a placed root gets a box", () => {
    const chain = nodes(
      ["root"],
      ["d1", "root"],
      ["d2", "d1"],
      ["d3", "d2"],
      ["d4", "d3"],
    );
    const derived = layoutTree(chain, boxes({ root: ROOT_BOX }));
    for (const n of chain.slice(1)) expect(derived.has(n.id)).toBe(true);
  });

  it("leaves a manually pinned child where it is, and keeps siblings clear of it", () => {
    const pin: TileLayout = { x: 4000, y: 4000, w: 300, h: 200 };
    const derived = layoutTree(
      nodes(["root"], ["pinned", "root"], ["next", "root"]),
      boxes({ root: ROOT_BOX, pinned: pin }),
    );
    // The pin is not re-derived...
    expect(derived.has(id("pinned"))).toBe(false);
    // ...but it still occupies a slot in the stack, so `next` clears its height.
    expect(derived.get(id("next"))?.y).toBe(ROOT_BOX.y + pin.h + SIBLING_GUTTER);
  });

  it("carries a subtree along when the parent is dragged (derivation is relative)", () => {
    const movedRoot: TileLayout = { ...ROOT_BOX, x: 5000, y: 6000 };
    const derived = layoutTree(
      nodes(["root"], ["child", "root"]),
      boxes({ root: movedRoot }),
    );
    expect(derived.get(id("child"))?.x).toBe(
      movedRoot.x + movedRoot.w + CHILD_GUTTER,
    );
    expect(derived.get(id("child"))?.y).toBe(movedRoot.y);
  });

  it("treats an edge pointing outside the set as a root, never dropping the node", () => {
    // Parent id isn't in `nodes` (still loading, or already gone).
    const orphans = nodes(["orphan", "missing-parent"]);
    expect(childrenByParent(orphans).size).toBe(0);
    // It derives nothing (the caller's cascade owns unpinned roots) but is not
    // silently swallowed by the child walk either.
    expect(layoutTree(orphans, boxes({})).size).toBe(0);
  });

  it("honours a per-id size policy", () => {
    const derived = layoutTree(
      nodes(["root"], ["big", "root"], ["small", "root"]),
      boxes({ root: ROOT_BOX }),
      (i) => (i === id("big") ? { w: 800, h: 540 } : { w: 200, h: 100 }),
    );
    expect(derived.get(id("big"))?.w).toBe(800);
    expect(derived.get(id("small"))?.h).toBe(100);
    // The stack respects each child's own height.
    expect(derived.get(id("small"))?.y).toBe(ROOT_BOX.y + 540 + SIBLING_GUTTER);
  });

  it("terminates on a parent cycle instead of looping forever", () => {
    const derived = layoutTree(
      nodes(["a", "b"], ["b", "a"]),
      boxes({ a: ROOT_BOX }),
    );
    expect(derived.get(id("b"))).toBeDefined();
  });
});

describe("descendantIds", () => {
  it("walks the whole subtree depth-first, excluding the root", () => {
    const byParent = childrenByParent([
      { id: id("root") },
      { id: id("a"), parentId: id("root") },
      { id: id("a1"), parentId: id("a") },
      { id: id("b"), parentId: id("root") },
    ]);
    expect(descendantIds(id("root"), byParent)).toEqual([
      id("a"),
      id("a1"),
      id("b"),
    ]);
    expect(descendantIds(id("a1"), byParent)).toEqual([]);
  });
});
