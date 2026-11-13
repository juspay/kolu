/** The `terminalAttach` consumer contract, pinned.
 *
 *  These are not spot-checks of a three-line predicate. Each case is a shape
 *  that cost a production incident, and the reason the rule ships with the
 *  stream rather than with whichever app learned it. */

import { describe, expect, it } from "vitest";
import {
  isSnapshotFrame,
  snapshotGrid,
  snapshotLayoutGrid,
  snapshotPaintableAt,
} from "./attach.ts";

const G = (cols: number, rows: number) => ({ cols, rows });

const snap = (grid?: { cols: number; rows: number }) =>
  ({
    kind: "snapshot",
    data: "x",
    topLine: 0,
    ...(grid ? { grid } : {}),
  }) as const;

describe("snapshotPaintableAt — rule 1", () => {
  it("paints bytes laid out at the grid the pane has now", () => {
    expect(snapshotPaintableAt(G(80, 24), G(80, 24))).toBe(true);
  });

  // The 66→65 column settle that blanked three panes at once. Painting is
  // irreversible: nothing rebuilds scrollback wrapped at the wrong width.
  it("refuses bytes laid out for a grid the pane does not have", () => {
    expect(snapshotPaintableAt(G(66, 24), G(65, 24))).toBe(false);
    expect(snapshotPaintableAt(G(80, 24), G(80, 25))).toBe(false);
  });

  // BOTH absences answer. Refusing on ignorance livelocks the reopen loop
  // against a pane that is not there — which is how rule 1's first spelling
  // failed when it was written to throw.
  it("accepts when either side has nothing to state — ignorance is not evidence", () => {
    for (const absent of [null, undefined]) {
      expect(snapshotPaintableAt(absent, G(80, 24))).toBe(true);
      expect(snapshotPaintableAt(G(80, 24), absent)).toBe(true);
      expect(snapshotPaintableAt(absent, absent)).toBe(true);
    }
  });
});

describe("snapshotLayoutGrid — which grid rule 1 judges by", () => {
  // THE CASE the asked grid cannot see: we asked at 120x40, another viewer
  // holds the pty at 80x24, and the bytes came back serialized at THEIRS. Two
  // local measurements agree; the wire disagrees, and the frame says so.
  it("prefers the frame's own grid over the grid we asked at", () => {
    expect(snapshotLayoutGrid(snap(G(80, 24)), G(120, 40))).toEqual(G(80, 24));
    expect(
      snapshotPaintableAt(
        snapshotLayoutGrid(snap(G(80, 24)), G(120, 40)),
        G(120, 40),
      ),
    ).toBe(false);
  });

  // The whole point of judging by the CURRENT grid: kaval drops its data
  // subscribers on a real resize and re-snapshots them mid-stream, so the frame
  // that answers this pane's own publish is laid out for the grid the pane
  // moved TO while the attach still remembers the grid it opened at. Judged
  // against the asked grid this was a refusal, a reset and a second round trip
  // — per resize, per viewer.
  it("paints a re-snapshot laid out at the pane's NEW grid, though the attach opened at the old one", () => {
    const openedAt = G(120, 40);
    const paneIsNow = G(132, 43);
    const frame = snap(paneIsNow);
    expect(
      snapshotPaintableAt(snapshotLayoutGrid(frame, openedAt), paneIsNow),
    ).toBe(true);
  });

  // Fail-open against a 5.4 padi: with no grid on the frame the only evidence
  // left is that the host serialized after applying our `resizeTo`, so the rule
  // degrades to exactly the asked-vs-current comparison it had before 5.5.
  it("falls back to the asked grid when the frame states none", () => {
    expect(snapshotLayoutGrid(snap(), G(120, 40))).toEqual(G(120, 40));
    expect(
      snapshotPaintableAt(snapshotLayoutGrid(snap(), G(120, 40)), G(120, 40)),
    ).toBe(true);
    expect(
      snapshotPaintableAt(snapshotLayoutGrid(snap(), G(66, 24)), G(65, 24)),
    ).toBe(false);
  });

  it("has nothing to state for an observe-only consumer against an old daemon", () => {
    expect(snapshotLayoutGrid(snap(), undefined)).toBeUndefined();
    expect(
      snapshotPaintableAt(snapshotLayoutGrid(snap(), null), G(80, 24)),
    ).toBe(true);
  });
});

describe("isSnapshotFrame", () => {
  it("narrows on the discriminant, not on the presence of topLine", () => {
    const snapshot = { kind: "snapshot", data: "x", topLine: 0 } as const;
    const delta = { kind: "delta", data: "x" } as const;
    expect(isSnapshotFrame(snapshot)).toBe(true);
    expect(isSnapshotFrame(delta)).toBe(false);
    // A delta carries no layout claim, so it is never stale — the whole reason
    // the check is scoped to the snapshot arm.
    if (isSnapshotFrame(snapshot)) expect(snapshot.topLine).toBe(0);
  });
});

describe("snapshotGrid — the observe-only answer (contract 5.5)", () => {
  it("reports the grid the bytes were serialized at", () => {
    expect(snapshotGrid(snap(G(100, 30)))).toEqual({ cols: 100, rows: 30 });
  });

  // Fail-open: a 5.4 padi sends no grid, and a consumer must size as it did
  // before rather than treat silence as a claim.
  it("is undefined from a daemon predating the field", () => {
    expect(snapshotGrid(snap())).toBeUndefined();
  });

  it("is undefined for a delta — only a snapshot has a layout", () => {
    expect(snapshotGrid({ kind: "delta", data: "x" })).toBeUndefined();
  });
});
