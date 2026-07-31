import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { descendantsByRoot, rootAncestorOf } from "./terminalTree";

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
