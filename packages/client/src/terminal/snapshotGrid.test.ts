import { describe, expect, it } from "vitest";
import { judgeSnapshotGrid } from "./snapshotGrid";

describe("judgeSnapshotGrid", () => {
  it("accepts a snapshot answered for the grid the pane still has", () => {
    expect(
      judgeSnapshotGrid({ cols: 98, rows: 8 }, { cols: 98, rows: 8 }),
    ).toBe("accept");
  });

  it("reopens when the pane got WIDER after the request", () => {
    // The width is what wraps: a snapshot laid out for 80 columns painted into a
    // 213-column pane is the original defect — every long line broken in half.
    expect(
      judgeSnapshotGrid({ cols: 80, rows: 24 }, { cols: 213, rows: 50 }),
    ).toBe("reopen");
  });

  it("reopens on a cols-only change", () => {
    expect(
      judgeSnapshotGrid({ cols: 100, rows: 30 }, { cols: 99, rows: 30 }),
    ).toBe("reopen");
  });

  it("reopens on a rows-only change", () => {
    // Height alone does not rewrap, but it does move the viewport — the split
    // stuck above its own live bottom was a rows change.
    expect(
      judgeSnapshotGrid({ cols: 100, rows: 30 }, { cols: 100, rows: 8 }),
    ).toBe("reopen");
  });

  it("accepts when either side is absent, rather than livelocking the reopen loop", () => {
    // Refusing on ignorance would reopen forever: each attempt would refuse its
    // own answer. Both reachable absences are benign — nothing requested yet, or
    // a disposed pane that has released its grid.
    expect(judgeSnapshotGrid(null, { cols: 98, rows: 8 })).toBe("accept");
    expect(judgeSnapshotGrid({ cols: 98, rows: 8 }, null)).toBe("accept");
    expect(judgeSnapshotGrid(null, null)).toBe("accept");
  });
});
