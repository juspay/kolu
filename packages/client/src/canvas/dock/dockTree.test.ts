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

function shellSubRow(
  id: string,
  depth = 1,
): Extract<SubRow, { kind: "shell" }> {
  return {
    id: id as TerminalId,
    kind: "shell",
    bucket: "idle",
    pip: "idle",
    ts: 1,
    depth,
  };
}

function agentSubRow(
  id: string,
  bucket: Extract<SubRow, { kind: "agent" }>["bucket"] = "idle",
  depth = 1,
): Extract<SubRow, { kind: "agent" }> {
  return {
    id: id as TerminalId,
    kind: "agent",
    bucket,
    pip: "idle",
    ts: 1,
    depth,
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
  it("keeps sections and rows in first-appearance order, whatever the clock says", () => {
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
    // Every `ts` here argues for a different order — c@2000 is the newest row
    // and b is the blocked one — and none of it moves anything. kolu leads
    // because `a` arrived first; `c` follows `a` for the same reason.
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(tree.groups[1]?.topRows.map((r) => r.id)).toEqual(["b"]);
  });

  // THE regression guard for #2141, and the one test that was red before it:
  // a row's position must be a function of the row SET alone, never of any
  // row's clock. Every earlier ordering test could be satisfied by a sort that
  // merely happened to agree with creation order on that fixture; this one
  // cannot — it holds the set fixed and moves only the clock.
  it("no row moves when another row's activity moves", () => {
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "one" },
      b: { group: "pierre", color: "#bbb", label: "two" },
      c: { group: "kolu", color: "#aaa", label: "three" },
    });
    // Clocks chosen so a recency sort would ORDER THESE TWO DIFFERENTLY —
    // otherwise the test passes under the very regression it exists to catch.
    // Old behaviour: before → sections [kolu, pierre], kolu rows [a, c];
    // after → [pierre, kolu] and [c, a]. Both legs move.
    const before = buildDockTree(
      [row("a", "idle", 300), row("b", "idle", 200), row("c", "idle", 100)],
      getInfo,
      false,
    );
    // `b`'s background agent finishes a turn and `c` prints a line — the exact
    // churn that used to yank pierre to the top and renumber every shortcut.
    const after = buildDockTree(
      [
        row("a", "idle", 300),
        row("b", "working", 9_000_000),
        row("c", "idle", 500),
      ],
      getInfo,
      false,
    );
    expect(after.groups.map((g) => g.name)).toEqual(
      before.groups.map((g) => g.name),
    );
    expect(after.flatShortcutRows.map((r) => r.id)).toEqual(
      before.flatShortcutRows.map((r) => r.id),
    );
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
    // Sections in first-appearance order (kolu, pierre, justci), rows within
    // kolu in creation order — the sequence the dock paints top to bottom, and
    // therefore the sequence `Cmd+1..4` walks.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
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

  it("a blocked row is mirrored onto the strip and does NOT move in the list", () => {
    const ranked = [
      row("a", "working", 1000),
      row("b", "awaiting", 400),
      row("c", "idle", 50),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "one" },
      b: { group: "pierre", color: "#bbb", label: "two" },
      c: { group: "kolu", color: "#aaa", label: "three" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    // The blocked row is surfaced…
    expect(tree.needsYou.map((r) => r.id)).toEqual(["b"]);
    // …and is STILL exactly where it was, in the section it belongs to. The
    // mirror is what makes both of those true at once.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
  });

  it("a blocked SPLIT puts its parent on the strip, still without moving it", () => {
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

    // The strip names the PARENT — the row you can actually click — even though
    // the blocked agent is the split underneath it.
    expect(tree.needsYou.map((r) => r.id)).toEqual(["parent"]);
    expect(tree.groups[0]?.topRows.map((entry) => entry.id)).toEqual([
      "recent",
      "parent",
    ]);
  });

  it("the strip claims no shortcut numbers", () => {
    // Blocking the LAST row is the case that would expose a strip feeding
    // `flatShortcutRows`: it would jump to position 1 and renumber everything.
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "one" },
      b: { group: "kolu", color: "#aaa", label: "two" },
    });
    const quiet = buildDockTree(
      [row("a", "idle", 100), row("b", "idle", 200)],
      getInfo,
      false,
    );
    const blocked = buildDockTree(
      [row("a", "idle", 100), row("b", "awaiting", 200)],
      getInfo,
      false,
    );
    expect(blocked.needsYou.map((r) => r.id)).toEqual(["b"]);
    expect(blocked.flatShortcutRows.map((r) => r.id)).toEqual(
      quiet.flatShortcutRows.map((r) => r.id),
    );
  });

  it("the strip mirrors only rows the filters actually left on screen", () => {
    // A parked row can still be `awaiting` — that is exactly the row the
    // activity window hides. Mirroring it would put a chip on the strip with
    // no row under it to jump to.
    const tree = buildDockTree(
      [row("shown", "awaiting", 1000), row("gone", "parked", 5)],
      makeGetInfo({
        shown: { group: "kolu", color: "#aaa", label: "one" },
        gone: { group: "kolu", color: "#aaa", label: "two" },
      }),
      false,
    );
    expect(tree.needsYou.map((r) => r.id)).toEqual(["shown"]);
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
