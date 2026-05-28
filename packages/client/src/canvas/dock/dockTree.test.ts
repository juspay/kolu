import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { buildDockTree } from "./dockTree";
import type { DockRowBucket, RankedDockRow } from "./dockRowRanking";

function row(id: string, bucket: DockRowBucket, ts: number): RankedDockRow {
  return { id: id as TerminalId, bucket, ts };
}

function makeGetInfo(
  entries: Record<string, { group: string; color: string; label?: string }>,
): (id: TerminalId) => TerminalDisplayInfo | undefined {
  return (id) => {
    const e = entries[id as string];
    if (!e) return undefined;
    return {
      repoColor: e.color,
      branchColor: e.color,
      annotationColor: e.color,
      meta: {
        cwd: "/tmp",
        git: null,
        pr: { kind: "absent" },
        agent: null,
        foreground: null,
        lastActivityAt: 0,
      },
      subCount: 0,
      key: { group: e.group, label: e.label ?? "main" },
    };
  };
}

describe("buildDockTree", () => {
  it("groups by repo and sorts both sections and rows by pure recency", () => {
    const ranked = [
      row("a", "working", 1000),
      row("b", "awaiting", 500),
      row("c", "idle", 2000),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "pierre", color: "#bbb" },
      c: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo);
    // Section recency: kolu's newest (c@2000) > pierre's newest (b@500).
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
    // Within kolu, c@2000 outranks a@1000 on pure recency — bucket no
    // longer promotes working over idle in the within-group order.
    expect(tree.groups[0]?.rows.map((r) => r.id)).toEqual(["c", "a"]);
    expect(tree.groups[1]?.rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("filters parked rows entirely and surfaces the count", () => {
    const ranked = [
      row("a", "awaiting", 1000),
      row("b", "parked", 500),
      row("c", "parked", 200),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
      c: { group: "pierre", color: "#bbb" },
    });
    const tree = buildDockTree(ranked, getInfo);
    expect(tree.parkedCount).toBe(2);
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]?.name).toBe("kolu");
    expect(tree.flatRows.map((r) => r.id)).toEqual(["a"]);
  });

  it("flatRows matches the rendered row sequence across groups", () => {
    const ranked = [
      row("a", "idle", 100),
      row("b", "awaiting", 200),
      row("c", "working", 300),
      row("d", "none", 0),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
      c: { group: "pierre", color: "#bbb" },
      d: { group: "justci", color: "#ccc" },
    });
    const tree = buildDockTree(ranked, getInfo);
    // Section order: pierre(300) > kolu(200) > justci(0). Within kolu,
    // b@200 > a@100 on recency.
    expect(tree.flatRows.map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("an awaiting row in a quieter repo does not promote its section above a more recent repo", () => {
    const ranked = [
      // Kolu has a fresh working row at 1000.
      row("a", "working", 1000),
      // Pierre has an awaiting row, but older — 400.
      row("b", "awaiting", 400),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "pierre", color: "#bbb" },
    });
    const tree = buildDockTree(ranked, getInfo);
    // Under bucket-priority, pierre's awaiting could outrank kolu at
    // the row layer; under pure recency, kolu wins because a@1000
    // beats b@400. The pip's pulse on b carries the attention signal
    // without dragging pierre above kolu in the list.
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
  });

  it("recency drives both section and row order — same-bucket rows tiebreak on ts", () => {
    const ranked = [
      row("a", "working", 100),
      row("b", "working", 500),
      row("c", "working", 300),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "pierre", color: "#bbb" },
      c: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo);
    // Pierre's newest (b@500) beats kolu's (c@300); within kolu, c@300
    // beats a@100.
    expect(tree.groups.map((g) => g.name)).toEqual(["pierre", "kolu"]);
    expect(tree.groups[1]?.rows.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("skips rows whose display info is missing", () => {
    const ranked = [row("a", "awaiting", 100), row("b", "working", 200)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      // b has no entry → buildTerminalDisplayInfos hasn't resolved it yet.
    });
    const tree = buildDockTree(ranked, getInfo);
    expect(tree.flatRows.map((r) => r.id)).toEqual(["a"]);
    expect(tree.parkedCount).toBe(0);
  });

  it("keeps same-branch terminals adjacent within a section, regardless of recency", () => {
    const ranked = [
      row("a", "working", 1000), // feat-x — newest of all three
      row("b", "idle", 500), // feat-y — between a and c in pure ts order
      row("c", "idle", 200), // feat-x — older than b, but same branch as a
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "feat-x" },
      b: { group: "kolu", color: "#aaa", label: "feat-y" },
      c: { group: "kolu", color: "#aaa", label: "feat-x" },
    });
    const tree = buildDockTree(ranked, getInfo);
    // Cluster feat-x (headline a@1000) outranks cluster feat-y
    // (headline b@500) on recency. Within feat-x, a@1000 > c@200.
    // Pure-recency interleaving would have been [a, b, c]; clustering
    // keeps a and c adjacent. The cluster headline is the same key
    // (-ts) as the section sort.
    expect(tree.groups[0]?.rows.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("an empty input yields zero groups and zero parked", () => {
    const tree = buildDockTree([], () => undefined);
    expect(tree.groups).toEqual([]);
    expect(tree.flatRows.map((r) => r.id)).toEqual([]);
    expect(tree.parkedCount).toBe(0);
  });
});
