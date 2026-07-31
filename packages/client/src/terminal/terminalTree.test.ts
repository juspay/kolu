import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  descendantsByRoot,
  type PaneNode,
  paneTreeOf,
  rootAncestorOf,
} from "./terminalTree";

const T = (s: string) => s as TerminalId;

/** Build a parent-edge reader from a partial map. Missing keys → `undefined`
 *  (absent from the census); explicit `null` → root. */
function edge(
  parents: Record<string, string | null>,
): (id: TerminalId) => TerminalId | null | undefined {
  return (id) => {
    if (!(id in parents)) return undefined;
    const p = parents[id as string];
    return p === null ? null : (p as TerminalId);
  };
}

describe("rootAncestorOf", () => {
  it("returns self for a root", () => {
    expect(rootAncestorOf(T("R"), edge({ R: null }))).toBe(T("R"));
  });

  it("walks a 3-deep chain to the root", () => {
    const parentOf = edge({ R: null, M: "R", G: "M" });
    expect(rootAncestorOf(T("G"), parentOf)).toBe(T("R"));
    expect(rootAncestorOf(T("M"), parentOf)).toBe(T("R"));
    expect(rootAncestorOf(T("R"), parentOf)).toBe(T("R"));
  });

  it("returns null on a cycle (never hides the node by inventing a root)", () => {
    expect(rootAncestorOf(T("A"), edge({ A: "B", B: "A" }))).toBeNull();
  });

  it("returns null when a parentId dangles at a missing node", () => {
    expect(rootAncestorOf(T("G"), edge({ G: "gone" }))).toBeNull();
  });
});

describe("descendantsByRoot (canvas flat splits)", () => {
  it("lands a 3-deep chain's every descendant under the root, in server order", () => {
    // Server order: root, middle, grandchild, then an unrelated second child of root.
    const ids = [T("R"), T("M"), T("G"), T("C")];
    const parentOf = edge({ R: null, M: "R", G: "M", C: "R" });
    const byRoot = descendantsByRoot(ids, parentOf);
    expect(byRoot.get(T("R"))).toEqual([T("M"), T("G"), T("C")]);
    // No other roots minted.
    expect([...byRoot.keys()]).toEqual([T("R")]);
  });

  it("preserves keys() order across two independent trees", () => {
    const ids = [T("A"), T("B"), T("A1"), T("B1"), T("A2")];
    const parentOf = edge({
      A: null,
      B: null,
      A1: "A",
      B1: "B",
      A2: "A",
    });
    const byRoot = descendantsByRoot(ids, parentOf);
    expect(byRoot.get(T("A"))).toEqual([T("A1"), T("A2")]);
    expect(byRoot.get(T("B"))).toEqual([T("B1")]);
  });

  it("omits cycle members from every root group (they paint as top-level)", () => {
    const ids = [T("R"), T("A"), T("B"), T("C")];
    const parentOf = edge({ R: null, A: "B", B: "A", C: "R" });
    const byRoot = descendantsByRoot(ids, parentOf);
    expect(byRoot.get(T("R"))).toEqual([T("C")]);
    expect(byRoot.has(T("A"))).toBe(false);
    expect(byRoot.has(T("B"))).toBe(false);
  });

  it("omits orphans whose parent is missing (they paint as top-level)", () => {
    const ids = [T("R"), T("orphan")];
    const parentOf = edge({ R: null, orphan: "gone" });
    const byRoot = descendantsByRoot(ids, parentOf);
    expect(byRoot.get(T("R"))).toEqual(undefined);
    expect([...byRoot.keys()]).toEqual([]);
  });
});

/** Every id in the tree, depth-first — the fold every tree consumer performs. */
function flattenPanes(nodes: readonly PaneNode[]): TerminalId[] {
  return nodes.flatMap((n) => [n.id, ...flattenPanes(n.children)]);
}

describe("paneTreeOf (Dock indented splits)", () => {
  it("nests a grandchild under its real parent, not under the root", () => {
    const ids = [T("R"), T("M"), T("G"), T("C")];
    const parentOf = edge({ R: null, M: "R", G: "M", C: "R" });
    const flat = descendantsByRoot(ids, parentOf).get(T("R")) ?? [];
    expect(paneTreeOf(T("R"), flat, parentOf)).toEqual([
      { id: T("M"), children: [{ id: T("G"), children: [] }] },
      { id: T("C"), children: [] },
    ]);
  });

  it("keeps siblings in server order", () => {
    const ids = [T("R"), T("A"), T("B")];
    const parentOf = edge({ R: null, A: "R", B: "R" });
    const flat = descendantsByRoot(ids, parentOf).get(T("R")) ?? [];
    expect(paneTreeOf(T("R"), flat, parentOf).map((n) => n.id)).toEqual([
      T("A"),
      T("B"),
    ]);
  });

  // THE invariant, and the whole reason the tree is a re-shaping of the flat
  // list rather than a second walk: the canvas paints `flat`, the Dock folds
  // the tree, and the two can never cover different terminals. Two independent
  // traversals is exactly how a split of a split ended up with a canvas tab and
  // no dock row at all (#2059).
  it("covers EXACTLY the flat canvas list — same ids, no more, no fewer", () => {
    const ids = [
      T("R"),
      T("M"),
      T("G"),
      T("C"),
      T("GG"),
      // Cycle + orphan: excluded from the flat list, so excluded from the tree.
      T("A"),
      T("B"),
      T("orphan"),
    ];
    const parentOf = edge({
      R: null,
      M: "R",
      G: "M",
      C: "R",
      GG: "G",
      A: "B",
      B: "A",
      orphan: "gone",
    });
    const byRoot = descendantsByRoot(ids, parentOf);
    for (const [root, flat] of byRoot) {
      expect(flattenPanes(paneTreeOf(root, flat, parentOf)).sort()).toEqual(
        [...flat].sort(),
      );
    }
    expect(byRoot.get(T("R"))).toHaveLength(4);
  });

  it("throws rather than silently re-homing a pane whose parent is not in the tile", () => {
    // Unreachable through `descendantsByRoot` (an accepted descendant's whole
    // chain is accepted too), so a throw here means the index broke — fail
    // loudly instead of quietly moving the pane up to the root.
    expect(() =>
      paneTreeOf(T("R"), [T("G")], edge({ R: null, G: "M", M: "R" })),
    ).toThrow(/no parent in the tile/);
  });
});
