/**
 * THE ORDER A PIECE OF WORK IS DRAWN IN — parent before the splits under it,
 * the root at the head, and every watched ref drawn exactly once whatever the
 * records say.
 *
 * The server publishes a group's members flat; the nesting is the browser's
 * own reading of a live `parentId`, so the two can disagree (a host that is
 * away keeps its grouping and has no records to read an edge from). That
 * disagreement is the interesting half of this module and it is pinned here,
 * where no fleet has to be mounted to produce it.
 */

import { describe, expect, it } from "vitest";
import { type WatchedTreeRow, watchedTreeRows } from "./watchedTree";

const ROOT = "local/root";
const PLANNER = "local/planner";
const IMPLEMENTOR = "local/implementor";
const REVIEWER = "local/reviewer";

/** The parent edge as a plain table — what the panel reads off each watched
 *  terminal's record. A ref the table does not name has no parent. */
const edges =
  (table: Record<string, string>) =>
  (ref: string): string | null =>
    table[ref] ?? null;

const drawn = (rows: readonly WatchedTreeRow[]) =>
  rows.map((row) => [row.ref, row.depth] as const);

describe("the order a group's rows are drawn in", () => {
  it("puts a split under the terminal it is a split of", () => {
    const rows = watchedTreeRows(
      [ROOT, IMPLEMENTOR],
      ROOT,
      edges({ [IMPLEMENTOR]: ROOT }),
    );
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [IMPLEMENTOR, 1],
    ]);
    expect(rows[1]?.parent).toBe(ROOT);
    expect(rows[0]?.parent).toBeNull();
  });

  it("heads the group with its root even when the root was watched last", () => {
    // A split is watched the moment it is created; the planner above it may
    // join the list afterwards (or have been there all along and been re-added
    // behind it). The group is still that terminal's.
    const rows = watchedTreeRows(
      [IMPLEMENTOR, ROOT],
      ROOT,
      edges({ [IMPLEMENTOR]: ROOT }),
    );
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [IMPLEMENTOR, 1],
    ]);
  });

  it("nests a split of a split the same way, depth first", () => {
    const rows = watchedTreeRows(
      [ROOT, PLANNER, IMPLEMENTOR, REVIEWER],
      ROOT,
      edges({
        [PLANNER]: ROOT,
        [IMPLEMENTOR]: PLANNER,
        [REVIEWER]: ROOT,
      }),
    );
    // The reviewer is a sibling of the planner, so it comes AFTER everything
    // under the planner rather than between them.
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [PLANNER, 1],
      [IMPLEMENTOR, 2],
      [REVIEWER, 1],
    ]);
  });

  it("keeps siblings in watch order", () => {
    const rows = watchedTreeRows(
      [ROOT, REVIEWER, IMPLEMENTOR],
      ROOT,
      edges({ [REVIEWER]: ROOT, [IMPLEMENTOR]: ROOT }),
    );
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [REVIEWER, 1],
      [IMPLEMENTOR, 1],
    ]);
  });

  it("draws a row whose parent is not watched at the top of the group", () => {
    // The server grouped these two together — it walked the edges while
    // reading their records — but the terminal between them is not on the
    // watch list, so there is no row here to sit under.
    const rows = watchedTreeRows(
      [ROOT, IMPLEMENTOR],
      ROOT,
      edges({ [IMPLEMENTOR]: "local/not-watched" }),
    );
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [IMPLEMENTOR, 0],
    ]);
    expect(rows[1]?.parent).toBeNull();
  });

  it("draws a row whose host is away at the top of the group", () => {
    // No record, no edge: the panel hands `null` for every ref it cannot read
    // a parent off, and the group — which is the server's and outlives the
    // connection — is still drawn whole.
    const rows = watchedTreeRows([ROOT, IMPLEMENTOR], ROOT, () => null);
    expect(drawn(rows)).toEqual([
      [ROOT, 0],
      [IMPLEMENTOR, 0],
    ]);
  });

  it("keeps the group whole when the root itself is not watched", () => {
    // The planner is watched, the top-level terminal it was split from is
    // not — the group still exists (the server published it) and its rows are
    // drawn in watch order under no row at all.
    const rows = watchedTreeRows(
      [PLANNER, IMPLEMENTOR],
      ROOT,
      edges({ [PLANNER]: ROOT, [IMPLEMENTOR]: PLANNER }),
    );
    expect(drawn(rows)).toEqual([
      [PLANNER, 0],
      [IMPLEMENTOR, 1],
    ]);
  });

  it("neither loops nor drops a row when the records name a cycle", () => {
    const rows = watchedTreeRows(
      [ROOT, PLANNER, IMPLEMENTOR],
      ROOT,
      edges({
        [ROOT]: IMPLEMENTOR,
        [PLANNER]: ROOT,
        [IMPLEMENTOR]: PLANNER,
      }),
    );
    // Every watched terminal is still on the list exactly once — which is the
    // property that matters, a panel being a reading of the watch list.
    expect(rows.map((row) => row.ref).sort()).toEqual(
      [ROOT, PLANNER, IMPLEMENTOR].sort(),
    );
    // ...and one of them lost its edge, so the drawing terminates.
    expect(rows.filter((row) => row.parent === null)).toHaveLength(1);
  });

  it("ignores a record that names itself as its own parent", () => {
    const rows = watchedTreeRows([ROOT], ROOT, edges({ [ROOT]: ROOT }));
    expect(drawn(rows)).toEqual([[ROOT, 0]]);
  });

  it("draws nothing for a group with no refs", () => {
    expect(watchedTreeRows([], ROOT, () => null)).toEqual([]);
  });
});
