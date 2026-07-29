import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { RankedDockRow } from "./dockRowRanking";
import { buildDockTree } from "./dockTree";

function row(
  id: string,
  bucket: RankedDockRow["bucket"],
  ts: number,
): RankedDockRow {
  // dockTree only reads `bucket`/`ts`; the pip is exercised in dockRowRanking's
  // own tests, so mirror the order bucket here.
  return {
    id: id as TerminalId,
    bucket,
    pip: "idle",
    ts,
    subRows: [],
  };
}

type SubRow = RankedDockRow["subRows"][number];

function shellSubRow(id: string): Extract<SubRow, { kind: "shell" }> {
  return {
    id: id as TerminalId,
    kind: "shell",
    bucket: "idle",
    pip: "idle",
    ts: 1,
  };
}

function agentSubRow(
  id: string,
  bucket: Extract<SubRow, { kind: "agent" }>["bucket"] = "idle",
): Extract<SubRow, { kind: "agent" }> {
  return {
    id: id as TerminalId,
    kind: "agent",
    bucket,
    pip: "idle",
    ts: 1,
  };
}

function makeGetInfo(
  entries: Record<string, { group: string; color: string; label?: string }>,
): (id: TerminalId) => TerminalDisplayInfo | undefined {
  return (id) => {
    const e = entries[id as string];
    if (!e) return undefined;
    return {
      repoColor: e.color,
      annotationColor: e.color,
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
    const tree = buildDockTree(ranked, getInfo, false);
    // Section recency: kolu's newest (c@2000) > pierre's newest (b@500).
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
    // Within kolu, c@2000 outranks a@1000 on pure recency — bucket no
    // longer promotes working over idle in the within-group order.
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["c", "a"]);
    expect(tree.groups[1]?.topRows.map((r) => r.id)).toEqual(["b"]);
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
    const tree = buildDockTree(ranked, getInfo, false);
    expect(tree.parkedCount).toBe(2);
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]?.name).toBe("kolu");
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a"]);
  });

  it("flatShortcutRows matches the rendered top-level sequence", () => {
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
    const tree = buildDockTree(ranked, getInfo, false);
    // Section order: pierre(300) > kolu(200) > justci(0). Within kolu,
    // b@200 > a@100 on recency.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("projects visible entry cardinality and rail splits without widening shortcuts", () => {
    const parent = row("a", "idle", 100);
    parent.subRows = [shellSubRow("a-shell"), agentSubRow("a-agent")];
    const tree = buildDockTree(
      [parent],
      makeGetInfo({ a: { group: "kolu", color: "#aaa" } }),
      false,
    );

    expect(tree.groups[0]?.railEntries).toHaveLength(3);
    expect(
      tree.groups[0]?.railEntries.map((entry) => [entry.kind, entry.row.id]),
    ).toEqual([
      ["top", "a"],
      ["split", "a-shell"],
      ["split", "a-agent"],
    ]);
    expect(tree.flatShortcutRows.map((entry) => entry.id)).toEqual(["a"]);
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
    const tree = buildDockTree(ranked, getInfo, false);
    // Under bucket-priority, pierre's awaiting could outrank kolu at
    // the row layer; under pure recency, kolu wins because a@1000
    // beats b@400. The pip's pulse on b carries the attention signal
    // without dragging pierre above kolu in the list.
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
  });

  it("promotes a parent when one of its split agents is blocked", () => {
    const recent = row("recent", "working", 1_000);
    const blockedSplitParent = row("parent", "idle", 10);
    blockedSplitParent.subRows = [agentSubRow("blocked", "awaiting")];
    const tree = buildDockTree(
      [recent, blockedSplitParent],
      makeGetInfo({
        recent: { group: "kolu", color: "#aaa", label: "recent" },
        parent: { group: "kolu", color: "#aaa", label: "blocked" },
      }),
      false,
    );

    expect(tree.groups[0]?.topRows.map((entry) => entry.id)).toEqual([
      "parent",
      "recent",
    ]);
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
    const tree = buildDockTree(ranked, getInfo, false);
    // Pierre's newest (b@500) beats kolu's (c@300); within kolu, c@300
    // beats a@100.
    expect(tree.groups.map((g) => g.name)).toEqual(["pierre", "kolu"]);
    expect(tree.groups[1]?.topRows.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("skips rows whose display info is missing", () => {
    const ranked = [row("a", "awaiting", 100), row("b", "working", 200)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      // b has no entry → buildTerminalDisplayInfos hasn't resolved it yet.
    });
    const tree = buildDockTree(ranked, getInfo, false);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a"]);
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
    const tree = buildDockTree(ranked, getInfo, false);
    // Cluster feat-x (headline a@1000) outranks cluster feat-y
    // (headline b@500) on recency. Within feat-x, a@1000 > c@200.
    // Pure-recency interleaving would have been [a, b, c]; clustering
    // keeps a and c adjacent. The cluster headline is the same key
    // (-ts) as the section sort.
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("an empty input yields zero groups and zero parked", () => {
    const tree = buildDockTree([], () => undefined, false);
    expect(tree.groups).toEqual([]);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual([]);
    expect(tree.parkedCount).toBe(0);
    expect(tree.sleepingCount).toBe(0);
  });

  it("counts sleeping rows but keeps them visible when hideSleeping is off", () => {
    const ranked = [
      row("a", "awaiting", 1000),
      row("b", "sleeping", 500),
      row("c", "sleeping", 200),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
      c: { group: "pierre", color: "#bbb" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    // Shown → they're in the tree, and the count still reports the total.
    expect(tree.sleepingCount).toBe(2);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("drops sleeping rows when hideSleeping is on, surfacing the count", () => {
    const ranked = [
      row("a", "awaiting", 1000),
      row("b", "sleeping", 500),
      row("c", "sleeping", 200),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
      c: { group: "pierre", color: "#bbb" },
    });
    const tree = buildDockTree(ranked, getInfo, true);
    expect(tree.sleepingCount).toBe(2);
    // Both sleeping rows are gone; only the awaiting row (and its group) remain.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a"]);
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu"]);
  });

  it("keeps the footer reachable: all-sleeping-hidden still has content", () => {
    // A dock of only sleeping terminals, all hidden — shortcut rows and parked are
    // both empty, so `sleepingCount` is the only thing keeping `hasContent`
    // true and the ☾ toggle on screen to bring them back.
    const ranked = [row("a", "sleeping", 500), row("b", "sleeping", 200)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo, true);
    expect(tree.flatShortcutRows).toHaveLength(0);
    expect(tree.parkedCount).toBe(0);
    expect(tree.sleepingCount).toBe(2);
    expect(tree.hasContent).toBe(true);
  });

  it("does not count parked rows as sleeping even when they were slept", () => {
    // A stale sleeping tile ranks `parked` (staleness wins), so it belongs to
    // parkedCount, not sleepingCount — the ☾ toggle only governs fresh ones.
    const ranked = [row("a", "sleeping", 900), row("b", "parked", 100)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    expect(tree.sleepingCount).toBe(1);
    expect(tree.parkedCount).toBe(1);
  });
});

describe("buildDockTree — allTopRows", () => {
  it("keeps a parked row in its repo's attention set even though it is hidden", () => {
    // The row the activity window dropped is the one that has been waiting
    // longest — exactly the one whose count must still reach the header.
    const ranked = [row("a", "working", 5), row("b", "parked", 1)];
    const getInfo = makeGetInfo({
      a: { group: "repo", color: "c" },
      b: { group: "repo", color: "c" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    const group = tree.groups[0];
    expect(group?.topRows.map((r) => r.id)).toEqual(["a"]);
    expect(group?.allTopRows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(tree.parkedCount).toBe(1);
  });

  it("drops a repo whose every row is filtered out — no header with no rows", () => {
    const tree = buildDockTree(
      [row("b", "parked", 1)],
      makeGetInfo({ b: { group: "repo", color: "c" } }),
      false,
    );
    expect(tree.groups).toEqual([]);
    expect(tree.parkedCount).toBe(1);
  });
});
