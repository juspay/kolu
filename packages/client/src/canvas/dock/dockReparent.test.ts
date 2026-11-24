import { describe, expect, it } from "vitest";
import type { ParentEdge } from "../../terminal/terminalTree";
import {
  type DockDropContext,
  dockAccepts,
  dockTargetOf,
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

describe("dockTargetOf", () => {
  it("names a row and the header, and nothing outside the row space", () => {
    expect(dockTargetOf(rowDragId("t1"))).toEqual({ kind: "row", id: "t1" });
    expect(dockTargetOf(HEADER_DROP_ID)).toEqual({ kind: "header" });
    expect(dockTargetOf("feat/x")).toBeNull();
  });
});

describe("dockAccepts — a drag answers only from its own id space", () => {
  it("lets a row drag land on rows and the header, never on a cluster", () => {
    expect(dockAccepts(rowDragId("t1"), rowDragId("t2"))).toBe(true);
    expect(dockAccepts(rowDragId("t1"), HEADER_DROP_ID)).toBe(true);
    expect(dockAccepts(rowDragId("t1"), "feat/x")).toBe(false);
  });

  it("lets a cluster drag land on clusters, never on a row or the header", () => {
    expect(dockAccepts("feat/x", "fix/y")).toBe(true);
    expect(dockAccepts("feat/x", rowDragId("t2"))).toBe(false);
    expect(dockAccepts("feat/x", HEADER_DROP_ID)).toBe(false);
  });
});
