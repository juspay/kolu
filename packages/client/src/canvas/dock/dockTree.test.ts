import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { RankedDockRow } from "./dockRowRanking";
import { buildDockTree } from "./dockTree";

/** A row whose folds AGREE — the ordinary case, where the attention frame has
 *  landed and metadata, paint and attention say the same thing.
 *
 *  The `pip` and `asking` arguments exist because they can disagree, and which
 *  one a consumer reads is load-bearing. Strip membership is the ATTENTION
 *  CLASS (`asking`) — the fold the wash, the wait chip and the section count all
 *  read. `pip` is that class narrowed by the dormancy overlay, which is a paint
 *  rule: a parked or sleeping row paints `parked`/`sleeping` while still being
 *  asking. Passing them separately is what lets {@link row} model both a frame
 *  that has not arrived yet and a blocked row the window has parked. `none` has
 *  no paint spelling, so it paints the quiet `idle`, exactly as `paintDockRow`
 *  does. */
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
    kind: "shell",
    bucket: "idle",
    pip: "idle",
    asking: false,
    ts: 1,
    depth,
  };
}

/** Same agreeing-folds default as {@link row}, for a split. */
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
    kind: "agent",
    bucket,
    pip,
    asking,
    ts,
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

  // The sibling of the guard above, covering the leg it cannot reach: the row
  // set is FIXED there, so no row ever crosses the activity window. Here one
  // row does — on a 60s clock tick, with no user action behind it — and the
  // survivors must keep their relative order. Two rows share a branch cluster
  // on purpose: bucketing after the filter made cluster first-appearance a
  // function of the VISIBLE rows, which is how hiding one row moved two others.
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
    // Clusters are main{t1,t3} then feat{t2} — first appearance, so t1 leads.
    expect(before.flatShortcutRows.map((r) => r.id)).toEqual([
      "t1",
      "t3",
      "t2",
    ]);

    // t1 ages past the activity window. Nothing else changed.
    const after = buildDockTree(
      [
        row("t1", "parked", 100),
        row("t2", "idle", 200),
        row("t3", "idle", 300),
      ],
      getInfo,
      false,
    );
    // t1 leaves; t3 and t2 keep their order. Deciding cluster order from the
    // visible rows instead would have promoted feat (t2 became the first
    // visible row) and returned ["t2", "t3"] — two rows moving because one was
    // hidden, and `Cmd+1`/`Cmd+2` swapping with them.
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
    // The count is filter-independent — it reports what the toggle is holding.
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
    // The blocked row is surfaced…
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["b"]);
    // …naming ITSELF as the blocked row, not just as a clickable tile…
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual(["b"]);
    expect(tree.needsYou.map((e) => e.hiddenByFilter)).toEqual([false]);
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

    // The strip names the PARENT as the row you can actually click…
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["parent"]);
    // …and the SPLIT as the row that is actually blocked. Collapsing that to a
    // boolean is what made the entry paint the parent's pip (no violet capsule
    // at all) and report the parent's tile-wide `ts` as a wait duration.
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual(["blocked"]);
    expect(tree.groups[0]?.topRows.map((entry) => entry.id)).toEqual([
      "recent",
      "parent",
    ]);
  });

  it("names the BLOCKED split even when a chattier sibling owns the tile's clock", () => {
    // The defect this pins: `parent.ts` is the tile-wide fold, so a noisy
    // sibling split makes it read "3s" while the blocked agent has waited
    // twenty hours. The entry has to carry the blocked row so the capsule can
    // read the blocked row's own clock.
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

  // A tile can hold several agents at once — the main pane plus its splits, or
  // two splits — and any of them can be blocked. Answering with the FIRST left
  // every other blocked agent in that tile surfaced by colour and animation
  // alone, which is the precise failure (fucknotif) this strip exists to end,
  // and no fixture had ever put two asking rows in one tile.
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
    // The main pane and BOTH blocked splits — three agents waiting, three
    // entries. The quiet split earns none.
    expect(tree.needsYou.map((e) => e.blocked.id)).toEqual([
      "tile",
      "split-a",
      "split-b",
    ]);
    // Every entry names the same clickable tile; only `blocked` differs.
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual([
      "tile",
      "tile",
      "tile",
    ]);
    // And the tile still occupies exactly one row in the list below.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["tile"]);
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
    expect(blocked.needsYou.map((e) => e.tile.id)).toEqual(["b"]);
    expect(blocked.flatShortcutRows.map((r) => r.id)).toEqual(
      quiet.flatShortcutRows.map((r) => r.id),
    );
  });

  // The strip is an ATTENTION surface, so it reads the attention CLASS
  // (`asking`) — the same value its own entry paints its violet wait capsule
  // from, and the same value the section header counts. Reading the ORDER fold
  // (`bucket`) put an entry under a "Needs you" heading whose own pip painted
  // idle and whose cell read "3m ago", inside a component whose whole claim is
  // that it cannot drift from the row it mirrors.
  it("takes strip membership from the attention class, not the order fold", () => {
    const getInfo = makeGetInfo({
      frameLate: { group: "kolu", color: "#aaa", label: "one" },
      painted: { group: "kolu", color: "#aaa", label: "two" },
    });
    const tree = buildDockTree(
      [
        // Metadata says blocked; the attention frame has not landed, so neither
        // the paint nor the class agrees. No entry — the strip would have
        // nothing to show.
        row("frameLate", "awaiting", 100, "idle"),
        row("painted", "awaiting", 200, "awaiting"),
      ],
      getInfo,
      false,
    );
    expect(tree.needsYou.map((e) => e.tile.id)).toEqual(["painted"]);
  });

  it("keeps a blocked row the activity window parked — marked, not dropped", () => {
    // THE fucknotif case, and the one the module header promises: an agent that
    // has waited twenty hours falls out of every finite activity window, so a
    // strip built from the visible rows hid exactly the row it exists for —
    // while the section header above went on counting it. `pip` is `parked`
    // here (the dormancy overlay wins for colour) and `asking` is still true,
    // which is why membership reads the class and not the paint.
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
    // It is genuinely absent from the sections — the strip is the only place
    // it surfaces, which is the point of carrying the flag rather than the row.
    expect(tree.flatShortcutRows.map((r) => r.id)).toEqual(["shown"]);
  });

  it("keeps a blocked row the ☾ toggle is hiding, and one whose whole repo vanished", () => {
    // Two independent legs the "derive from the visible list" shape lost:
    // a shown-or-hidden SLEEPING row that is asking (the ☾ toggle is a
    // different filter from the window), and a blocked row whose repo has no
    // surviving section at all — that group is dropped from `groups`, so a
    // strip walking the surviving groups would lose the row with it.
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
    // The filter rule has ONE spelling now — `hiddenCount` is counted through
    // the same predicate the entries carry, not re-derived as arithmetic.
    expect(tree.hiddenCount).toBe(2);
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

  it("keeps same-branch terminals adjacent within a section", () => {
    // Creation order a, b, c — and the clocks deliberately DISAGREE with it, so
    // the assertion cannot be satisfied by a recency sort that happens to
    // coincide. (It could before: the old fixture's clocks descended in
    // creation order, so the test went on passing after the sorts were deleted
    // while its comment explained the result by a mechanism that had gone.)
    const ranked = [
      row("a", "working", 200), // feat-x — created first, OLDEST clock
      row("b", "idle", 1000), // feat-y — newest clock of the three
      row("c", "idle", 500), // feat-x — same branch as a, created last
    ];
    const getInfo = makeGetInfo({
      a: { group: "kolu", color: "#aaa", label: "feat-x" },
      b: { group: "kolu", color: "#aaa", label: "feat-y" },
      c: { group: "kolu", color: "#aaa", label: "feat-x" },
    });
    const tree = buildDockTree(ranked, getInfo, false);
    // feat-x leads because `a` appeared first; `c` joins its cluster and so
    // sits beside it, ahead of feat-y — even though `b` is the newest row in
    // the section. Clustering is the one thing that moves a row off strict
    // creation order, and it moves on a branch, never on a clock.
    // (Recency would have given [b, c, a]; strict creation order [a, b, c].)
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
