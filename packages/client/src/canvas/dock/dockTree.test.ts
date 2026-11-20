import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { RankedDockRow } from "./dockRowRanking";
import type { DockOrder } from "../../terminal/dockOrder";
import {
  buildDockTree,
  moveCluster,
  moveRepo,
  spliceVisiblePermutation,
} from "./dockTree";

function row(
  id: string,
  bucket: RankedDockRow["bucket"],
  ts: number,
  pip: RankedDockRow["pip"] = bucket === "none" ? "idle" : bucket,
  asking: boolean = pip === "awaiting",
): RankedDockRow {
  return {
    id: id as TerminalId,
    bucket,
    pip,
    asking,
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
    parentId: "parent" as TerminalId,
    kind: "shell",
    bucket: "idle",
    pip: "idle",
    asking: false,
    ts: 1,
    depth,
  };
}

function agentSubRow(
  id: string,
  bucket: Extract<SubRow, { kind: "agent" }>["bucket"] = "idle",
  depth = 1,
  pip: Extract<SubRow, { kind: "agent" }>["pip"] = bucket,
  asking: boolean = pip === "awaiting",
  ts = 1,
): Extract<SubRow, { kind: "agent" }> {
  return {
    id: id as TerminalId,
    parentId: "parent" as TerminalId,
    kind: "agent",
    bucket,
    pip,
    asking,
    ts,
    depth,
  };
}

function sleepingSubRow(id: string): SubRow {
  return {
    id: id as TerminalId,
    parentId: "tile" as TerminalId,
    kind: "shell",
    bucket: "sleeping",
    pip: "sleeping",
    asking: false,
    ts: 400,
    depth: 1,
  } as SubRow;
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
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu", "pierre"]);
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(tree.groups[1]?.topRows.map((r) => r.id)).toEqual(["b"]);
  });

  it("no row moves when another row's activity moves", () => {
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "one" },
      b: { group: "pierre", color: "#bbb", label: "two" },
      c: { group: "kolu", color: "#aaa", label: "three" },
    });
    const before = buildDockTree(
      [row("a", "idle", 300), row("b", "idle", 200), row("c", "idle", 100)],
      getInfo,
      false,
    );
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

  it("hiding a row on the clock does not reorder the rows that remain", () => {
    const getInfo = makeGetInfo({
      t1: { group: "kolu", color: "#aaa", label: "main" },
      t2: { group: "kolu", color: "#aaa", label: "feat" },
      t3: { group: "kolu", color: "#aaa", label: "main" },
    });
    const before = buildDockTree(
      [row("t1", "idle", 100), row("t2", "idle", 200), row("t3", "idle", 300)],
      getInfo,
      false,
    );
    expect(before.flatShortcutRows.map((r) => r.id)).toEqual([
      "t1",
      "t3",
      "t2",
    ]);

    const after = buildDockTree(
      [
        row("t1", "parked", 100),
        row("t2", "idle", 200),
        row("t3", "idle", 300),
      ],
      getInfo,
      false,
    );
    expect(after.flatShortcutRows.map((r) => r.id)).toEqual(["t3", "t2"]);
    expect(after.parkedCount).toBe(1);
  });

  it("the ☾ toggle hides sleeping rows without reordering the rest", () => {
    const getInfo = makeGetInfo({
      t1: { group: "kolu", color: "#aaa", label: "main" },
      t2: { group: "kolu", color: "#aaa", label: "feat" },
      t3: { group: "kolu", color: "#aaa", label: "main" },
    });
    const rows = [
      row("t1", "sleeping", 100),
      row("t2", "idle", 200),
      row("t3", "idle", 300),
    ];
    expect(
      buildDockTree(rows, getInfo, false).flatShortcutRows.map((r) => r.id),
    ).toEqual(["t1", "t3", "t2"]);
    const hidden = buildDockTree(rows, getInfo, true);
    expect(hidden.flatShortcutRows.map((r) => r.id)).toEqual(["t3", "t2"]);
    expect(hidden.sleepingCount).toBe(1);
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
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["b"]);
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual(["b"]);
    expect(tree.needsYou.map((e) => e.hiddenByFilter)).toEqual([false]);
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

    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["parent"]);
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual(["blocked"]);
    expect(tree.groups[0]?.topRows.map((entry) => entry.id)).toEqual([
      "recent",
      "parent",
    ]);
  });

  it("names the BLOCKED split even when a chattier sibling owns the tile's clock", () => {
    const parent = row("parent", "idle", 9_000_000);
    parent.subRows = [
      agentSubRow("chatty", "working", 1, "working", false, 9_000_000),
      agentSubRow("blocked", "awaiting", 1, "awaiting", true, 10),
    ];
    const tree = buildDockTree(
      [parent],
      makeGetInfo({ parent: { group: "kolu", color: "#aaa" } }),
      false,
    );
    expect(tree.needsYou[0]?.blocked.id).toBe("blocked");
    expect(tree.needsYou[0]?.blocked.ts).toBe(10);
    expect(tree.needsYou[0]?.tile.ts).toBe(9_000_000);
  });

  it("gives every blocked agent in a tile its own entry, not just the first", () => {
    const tile = row("tile", "awaiting", 100);
    tile.subRows = [
      agentSubRow("split-a", "awaiting"),
      agentSubRow("split-quiet", "idle"),
      agentSubRow("split-b", "awaiting"),
    ];
    const tree = buildDockTree(
      [tile],
      makeGetInfo({ tile: { group: "kolu", color: "#aaa", label: "one" } }),
      false,
    );
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual([
      "tile",
      "split-a",
      "split-b",
    ]);
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual([
      "tile",
      "tile",
      "tile",
    ]);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["tile"]);
  });

  it("the strip claims no shortcut numbers", () => {
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
    expect(blocked.needsYou.map((e) => e.tile.id)).toEqual(["b"]);
    expect(blocked.flatShortcutRows.map((r) => r.id)).toEqual(
      quiet.flatShortcutRows.map((r) => r.id),
    );
  });

  it("takes strip membership from the attention class, not the order fold", () => {
    const getInfo = makeGetInfo({
      frameLate: { group: "kolu", color: "#aaa", label: "one" },
      painted: { group: "kolu", color: "#aaa", label: "two" },
    });
    const tree = buildDockTree(
      [
        row("frameLate", "awaiting", 100, "idle"),
        row("painted", "awaiting", 200, "awaiting"),
      ],
      getInfo,
      false,
    );
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["painted"]);
  });

  it("keeps a blocked row the activity window parked — marked, not dropped", () => {
    const tree = buildDockTree(
      [
        row("shown", "awaiting", 1000),
        row("waited20h", "parked", 5, "parked", true),
      ],
      makeGetInfo({
        shown: { group: "kolu", color: "#aaa", label: "one" },
        waited20h: { group: "kolu", color: "#aaa", label: "two" },
      }),
      false,
    );
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["shown", "waited20h"]);
    expect(tree.needsYou.map((e) => e.hiddenByFilter)).toEqual([false, true]);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["shown"]);
  });

  it("keeps a blocked row the ☾ toggle is hiding, and one whose whole repo vanished", () => {
    const tree = buildDockTree(
      [
        row("dozing", "sleeping", 900, "sleeping", true),
        row("lonely", "parked", 5, "parked", true),
      ],
      makeGetInfo({
        dozing: { group: "kolu", color: "#aaa", label: "one" },
        lonely: { group: "pierre", color: "#bbb", label: "two" },
      }),
      true,
    );
    expect(tree.groups.map((g) => g.name)).toEqual([]);
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["dozing", "lonely"]);
    expect(tree.needsYou.map((e) => e.hiddenByFilter)).toEqual([true, true]);
    expect(tree.hiddenCount).toBe(2);
  });

  it("skips rows whose display info is missing", () => {
    const ranked = [row("a", "awaiting", 100), row("b", "working", 200)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a"]);
    expect(tree.parkedCount).toBe(0);
  });

  it("keeps same-branch terminals adjacent within a section", () => {
    const ranked = [
      row("a", "working", 200),
      row("b", "idle", 1000),
      row("c", "idle", 500),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "feat-x" },
      b: { group: "kolu", color: "#aaa", label: "feat-y" },
      c: { group: "kolu", color: "#aaa", label: "feat-x" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
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
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["a"]);
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu"]);
  });

  it("keeps the footer reachable: all-sleeping-hidden still has content", () => {
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
    const ranked = [row("a", "sleeping", 900), row("b", "parked", 100)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa" },
      b: { group: "kolu", color: "#aaa" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    expect(tree.sleepingCount).toBe(1);
    expect(tree.parkedCount).toBe(1);
  });

  it("a slept FAMILY counts and hides as its members, not just the tile", () => {
    const tile = row("tile", "sleeping", 500, "sleeping");
    tile.subRows = [sleepingSubRow("split"), shellSubRow("awake-split")];
    const ranked = [tile, row("other", "working", 900)];
    const getInfo = makeGetInfo({
      tile: { group: "kolu", color: "#aaa" },
      other: { group: "kolu", color: "#aaa" },
    });

    const shown = buildDockTree(ranked, getInfo, false);
    expect(shown.sleepingCount).toBe(2);

    const hidden = buildDockTree(ranked, getInfo, true);
    expect(hidden.hiddenCount).toBe(3);
    expect(hidden.flatShortcutRows.map((r) => r.id)).toEqual(["other"]);
  });

  it("hides a sleeping split under a LIVE tile without hiding the tile", () => {
    const tile = row("tile", "working", 500);
    tile.subRows = [sleepingSubRow("split"), shellSubRow("awake")];
    const ranked = [tile];
    const getInfo = makeGetInfo({ tile: { group: "kolu", color: "#aaa" } });

    const hidden = buildDockTree(ranked, getInfo, true);
    expect(hidden.flatShortcutRows.map((r) => r.id)).toEqual(["tile"]);
    expect(hidden.flatShortcutRows[0]?.subRows.map((s) => s.id)).toEqual([
      "awake",
    ]);
    expect(hidden.sleepingCount).toBe(1);
    expect(hidden.hiddenCount).toBe(1);
  });
});

describe("buildDockTree — allTopRows", () => {
  it("keeps a parked row in its repo's attention set even though it is hidden", () => {
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

describe("buildDockTree — user order overlay (#2247)", () => {
  it("pins repos first in pinned order, trailing unpinned in creation order", () => {
    const ranked = [
      row("a", "idle", 1),
      row("b", "idle", 2),
      row("c", "idle", 3),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1" },
      b: { group: "pierre", color: "#2" },
      c: { group: "justci", color: "#3" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "pierre", labels: [] },
    ]);
    expect(tree.groups.map((g) => g.name)).toEqual([
      "pierre",
      "kolu",
      "justci",
    ]);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("uses the FULL pinned order, including repos already in structural order", () => {
    const ranked = [
      row("a", "idle", 1),
      row("b", "idle", 2),
      row("c", "idle", 3),
      row("d", "idle", 4),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1" },
      b: { group: "pierre", color: "#2" },
      c: { group: "justci", color: "#3" },
      d: { group: "nix", color: "#4" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "justci", labels: [] },
      { repo: "kolu", labels: [] },
      { repo: "nix", labels: [] },
      { repo: "pierre", labels: [] },
    ]);
    expect(tree.groups.map((g) => g.name)).toEqual([
      "justci",
      "kolu",
      "nix",
      "pierre",
    ]);
  });

  it("orders clusters within a repo by stored label, unpinned trailing", () => {
    const ranked = [
      row("m1", "idle", 1, "working"),
      row("f", "idle", 2, "working"),
      row("m2", "idle", 3, "working"),
    ];
    const getInfo = makeGetInfo({
      m1: { group: "kolu", color: "#1", label: "main" },
      f: { group: "kolu", color: "#1", label: "feat" },
      m2: { group: "kolu", color: "#1", label: "main" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "kolu", labels: ["feat", "main"] },
    ]);
    expect(tree.groups[0]?.clusters.map((c) => c.label)).toEqual([
      "feat",
      "main",
    ]);
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["f", "m1", "m2"]);
  });

  it("keeps rows inside a dragged cluster in creation order", () => {
    const ranked = [
      row("m1", "idle", 3, "working"),
      row("m0", "idle", 1, "working"),
    ];
    const getInfo = makeGetInfo({
      m1: { group: "kolu", color: "#1", label: "main" },
      m0: { group: "kolu", color: "#1", label: "main" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "kolu", labels: ["main"] },
    ]);
    expect(tree.groups[0]?.topRows.map((r) => r.id)).toEqual(["m1", "m0"]);
  });

  it("ignores unknown repos and labels in the stored order", () => {
    const ranked = [row("a", "idle", 1), row("b", "idle", 2)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1", label: "main" },
      b: { group: "kolu", color: "#1", label: "feat" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "kolu", labels: ["ghost-label", "feat"] },
      { repo: "ghost-repo", labels: [] },
    ]);
    expect(tree.groups.map((g) => g.name)).toEqual(["kolu"]);
    expect(tree.groups[0]?.clusters.map((c) => c.label)).toEqual([
      "feat",
      "main",
    ]);
  });

  it("new rows still append under order: nothing pinned moves what never existed before", () => {
    const ranked = [row("a", "idle", 1), row("b", "idle", 2)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1" },
      b: { group: "pierre", color: "#2" },
    });
    const base = buildDockTree(ranked, getInfo, false, [
      { repo: "pierre", labels: [] },
    ]);
    const newRow = [...ranked, row("c", "idle", 3)];
    const grown = buildDockTree(
      newRow,
      makeGetInfo({
        a: { group: "kolu", color: "#1" },
        b: { group: "pierre", color: "#2" },
        c: { group: "nix", color: "#3" },
      }),
      false,
      [{ repo: "pierre", labels: [] }],
    );
    expect(base.groups.map((g) => g.name)).toEqual(["pierre", "kolu"]);
    expect(grown.groups.map((g) => g.name)).toEqual(["pierre", "kolu", "nix"]);
    const newBranch = [...ranked, row("m", "idle", 4)];
    const grownBranch = buildDockTree(
      newBranch,
      makeGetInfo({
        a: { group: "kolu", color: "#1", label: "main" },
        b: { group: "pierre", color: "#2" },
        m: { group: "kolu", color: "#1", label: "new-feat" },
      }),
      false,
      [
        { repo: "pierre", labels: [] },
        { repo: "kolu", labels: ["main"] },
      ],
    );
    expect(
      grownBranch.groups
        .find((g) => g.name === "kolu")
        ?.clusters.map((c) => c.label),
    ).toEqual(["main", "new-feat"]);
  });

  it("filters never move survivors — hiding a row only removes it", () => {
    const ranked = [
      row("a", "idle", 1),
      row("b", "parked", 2),
      row("c", "idle", 3),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1", label: "main" },
      b: { group: "kolu", color: "#1", label: "feat" },
      c: { group: "pierre", color: "#2" },
    });
    const order: DockOrder = [
      { repo: "pierre", labels: [] },
      { repo: "kolu", labels: ["feat", "main"] },
    ];
    const visible = buildDockTree(ranked, getInfo, false, order);
    expect(visible.flatShortcutRows.map((r) => r.id)).toEqual(["c", "a"]);
    const allVisible = buildDockTree(
      [row("a", "idle", 1), row("b", "idle", 2), row("c", "idle", 3)],
      getInfo,
      false,
      order,
    );
    expect(allVisible.flatShortcutRows.map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("flatShortcutRows follows the sequenced order", () => {
    const ranked = [
      row("a", "idle", 1),
      row("b", "idle", 2),
      row("c", "idle", 3),
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1", label: "main" },
      b: { group: "kolu", color: "#1", label: "feat" },
      c: { group: "pierre", color: "#2" },
    });
    const tree = buildDockTree(ranked, getInfo, false, [
      { repo: "pierre", labels: [] },
      { repo: "kolu", labels: ["feat", "main"] },
    ]);
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("needsYou is cluster-ordered within a group (no intra-group drift)", () => {
    const getInfo = makeGetInfo({
      m: { group: "kolu", color: "#1", label: "main" },
      f: { group: "kolu", color: "#1", label: "feat" },
    });
    const tree = buildDockTree(
      [row("f", "awaiting", 1), row("m", "awaiting", 2)],
      getInfo,
      false,
      [{ repo: "kolu", labels: ["feat", "main"] }],
    );
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["f", "m"]);
  });

  it("the tree's `order` round-trips, including fully-filtered groups", () => {
    const ranked = [row("a", "idle", 1), row("b", "parked", 2)];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#1", label: "main" },
      b: { group: "pierre", color: "#2", label: "main" },
    });
    const order: DockOrder = [
      { repo: "pierre", labels: ["main"] },
      { repo: "kolu", labels: ["main"] },
    ];
    const tree = buildDockTree(ranked, getInfo, false, order);
    expect(tree.order).toEqual(order);
  });

  it("spliceVisiblePermutation pins hidden clusters to their slots (#2247 arch review)", () => {
    expect(
      spliceVisiblePermutation(["main", "winhba", "feat"], ["feat", "main"]),
    ).toEqual(["feat", "winhba", "main"]);
  });

  it("moveRepo moves the named slot and keeps everything else put", () => {
    const order = buildDockTree(
      [row("a", "none", 1), row("b", "none", 2), row("c", "none", 3)],
      makeGetInfo({
        a: { group: "a", color: "#1" },
        b: { group: "b", color: "#2" },
        c: { group: "c", color: "#3" },
      }),
      false,
    ).order;
    expect(moveRepo(order, "c", "a")).toEqual([
      { repo: "c", labels: ["main"] },
      { repo: "a", labels: ["main"] },
      { repo: "b", labels: ["main"] },
    ]);
    expect(moveRepo(order, "ghost", "a")).toEqual(order);
  });

  it("moveCluster splices a visible permutation over the all-slots labels", () => {
    const order = buildDockTree(
      [
        row("k1", "none", 1),
        row("k2", "none", 2),
        row("k3", "none", 3),
        row("p1", "none", 4),
      ],
      makeGetInfo({
        k1: { group: "kolu", color: "#1", label: "main" },
        k2: { group: "kolu", color: "#1", label: "hidden-branch" },
        k3: { group: "kolu", color: "#1", label: "feat" },
        p1: { group: "pierre", color: "#2", label: "main" },
      }),
      false,
    ).order;
    expect(moveCluster(order, "kolu", ["feat", "main"])).toEqual([
      { repo: "kolu", labels: ["feat", "hidden-branch", "main"] },
      { repo: "pierre", labels: ["main"] },
    ]);
  });
});
