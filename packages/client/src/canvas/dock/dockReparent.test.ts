import { sortCollisions } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/collision";
import { Rectangle } from "@dnd-kit/geometry";
import { describe, expect, it } from "vitest";
import type { ParentEdge } from "../../terminal/terminalTree";
import {
  type DockDropContext,
  dockCollisionDetector,
  dropHighlightOf,
  HEADER_DROP_ID,
  reparentDropOf,
  rowDragId,
  rowIdOfDragId,
} from "./dockReparent";

/** A census keyed by id: missing key → `undefined` (absent from the census),
 *  `null` → a root, a string → that parent. */
function census(edges: Record<string, string | null | undefined>): ParentEdge {
  return (id) => edges[id];
}

function ctx(
  edges: Record<string, string | null | undefined>,
  live: readonly string[],
): DockDropContext {
  const alive = new Set<string>(live);
  return { parentEdge: census(edges), isLive: (id) => alive.has(id) };
}

describe("row id space", () => {
  it("round-trips a terminal id", () => {
    expect(rowDragId("t1")).toBe("row:t1");
    expect(rowIdOfDragId(rowDragId("t1"))).toBe("t1");
  });

  it("returns null for an id outside the row space", () => {
    expect(rowIdOfDragId(HEADER_DROP_ID)).toBeNull();
    expect(rowIdOfDragId("feat/x")).toBeNull();
    expect(rowIdOfDragId(7)).toBeNull();
  });
});

describe("reparentDropOf — row → row", () => {
  it("nests the dragged row under the target", () => {
    const c = ctx({ a: null, b: null }, ["a", "b"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "b" })).toEqual({
      id: "a",
      parentId: "b",
    });
  });

  it("refuses the row itself", () => {
    const c = ctx({ a: null }, ["a"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "a" })).toBeNull();
  });

  it("refuses the row's own child", () => {
    const c = ctx({ a: null, b: "a" }, ["a", "b"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "b" })).toBeNull();
  });

  it("refuses a deeper descendant", () => {
    const c = ctx({ a: null, b: "a", c: "b" }, ["a", "b", "c"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "c" })).toBeNull();
  });

  it("refuses the row's current parent (no-op)", () => {
    const c = ctx({ a: null, b: "a" }, ["a", "b"]);
    expect(reparentDropOf(c, "b", { kind: "row", id: "a" })).toBeNull();
  });

  it("refuses a target that is not live", () => {
    const c = ctx({ a: null, b: null }, ["a"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "b" })).toBeNull();
  });

  it("refuses a target absent from the census", () => {
    const c = ctx({ a: null }, ["a", "ghost"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "ghost" })).toBeNull();
  });

  it("allows a drop when the target's own chain dangles above it", () => {
    const c = ctx({ a: "ghost", b: null }, ["a", "b"]);
    expect(reparentDropOf(c, "b", { kind: "row", id: "a" })).toEqual({
      id: "b",
      parentId: "a",
    });
  });
});

describe("reparentDropOf — header", () => {
  it("unsplits a split back to a top-level tile", () => {
    const c = ctx({ a: null, b: "a" }, ["a", "b"]);
    expect(reparentDropOf(c, "b", { kind: "header" })).toEqual({
      id: "b",
      parentId: null,
    });
  });

  it("refuses an already top-level row", () => {
    const c = ctx({ a: null }, ["a"]);
    expect(reparentDropOf(c, "a", { kind: "header" })).toBeNull();
  });

  it("refuses a row absent from the census", () => {
    const c = ctx({ a: null }, ["a"]);
    expect(reparentDropOf(c, "ghost", { kind: "header" })).toBeNull();
  });
});

describe("reparentDropOf — cycles", () => {
  it("refuses a descendant target reached around a cycle", () => {
    const c = ctx({ a: "b", b: "c", c: "a" }, ["a", "b", "c"]);
    expect(reparentDropOf(c, "a", { kind: "row", id: "c" })).toBeNull();
  });

  it("does not hang when the target's chain is a cycle the row is not part of", () => {
    const c = ctx({ a: "b", b: "a", c: null }, ["a", "b", "c"]);
    expect(reparentDropOf(c, "c", { kind: "row", id: "a" })).toEqual({
      id: "c",
      parentId: "a",
    });
  });
});

describe("dropHighlightOf — one rule, two readers", () => {
  it("says over exactly when the verb accepts", () => {
    const c = ctx({ a: null, b: null }, ["a", "b"]);
    const target = { kind: "row", id: "b" } as const;
    expect(dropHighlightOf(c, "a", target)).toBe("over");
    expect(reparentDropOf(c, "a", target)).not.toBeNull();
  });

  it("says invalid exactly when the verb refuses", () => {
    const c = ctx({ a: null }, ["a"]);
    const target = { kind: "header" } as const;
    expect(dropHighlightOf(c, "a", target)).toBe("invalid");
    expect(reparentDropOf(c, "a", target)).toBeNull();
  });
});

type Point = { x: number; y: number };
type DetectorInput = Parameters<CollisionDetector>[0];

/** A 10×10 box centred on `center` — the shape of the dragged element and of
 *  every droppable below. */
function box(center: Point): Rectangle {
  return new Rectangle(center.x - 5, center.y - 5, 10, 10);
}

/** What a drag scope resolves to: every droppable asked through the detector,
 *  the answers ranked the way dnd-kit ranks them. The pointer sits at the
 *  dragged element's centre. */
function resolve(
  dragged: { id: string; at: Point },
  droppables: { id: string; at: Point }[],
): string | null {
  const dragOperation = {
    source: { id: dragged.id },
    shape: { current: box(dragged.at) },
    position: { current: dragged.at },
  } as unknown as DetectorInput["dragOperation"];
  const [first] = droppables
    .map((d) =>
      dockCollisionDetector({
        dragOperation,
        droppable: {
          id: d.id,
          shape: box(d.at),
        } as unknown as DetectorInput["droppable"],
      }),
    )
    .filter((c) => c !== null)
    .sort(sortCollisions);
  return first === undefined ? null : String(first.id);
}

describe("dockCollisionDetector", () => {
  it("ignores a nearer cluster droppable on a row drag", () => {
    const chosen = resolve({ id: rowDragId("t1"), at: { x: 0, y: 0 } }, [
      { id: "feat/x", at: { x: 0, y: 0 } },
      { id: rowDragId("t2"), at: { x: 100, y: 0 } },
    ]);
    expect(chosen).toBe(rowDragId("t2"));
  });

  it("picks the header on a row drag when no row is nearer", () => {
    const chosen = resolve({ id: rowDragId("t1"), at: { x: 0, y: 0 } }, [
      { id: HEADER_DROP_ID, at: { x: 10, y: 0 } },
      { id: rowDragId("t2"), at: { x: 100, y: 0 } },
    ]);
    expect(chosen).toBe(HEADER_DROP_ID);
  });

  it("never resolves a cluster drag to a row or the header", () => {
    const chosen = resolve({ id: "feat/x", at: { x: 0, y: 0 } }, [
      { id: rowDragId("t2"), at: { x: 1, y: 0 } },
      { id: HEADER_DROP_ID, at: { x: 2, y: 0 } },
      { id: "fix/y", at: { x: 3, y: 0 } },
    ]);
    expect(chosen).toBe("fix/y");
  });

  it("resolves nothing when a cluster drag has only row-space droppables", () => {
    const chosen = resolve({ id: "feat/x", at: { x: 0, y: 0 } }, [
      { id: rowDragId("t2"), at: { x: 1, y: 0 } },
      { id: HEADER_DROP_ID, at: { x: 2, y: 0 } },
    ]);
    expect(chosen).toBeNull();
  });
});
