/** The `terminalAttach` consumer contract, pinned.
 *
 *  These are not spot-checks of a three-line predicate. Each case is a shape
 *  that cost a production incident, and the reason the rule ships with the
 *  stream rather than with whichever app learned it. */

import { describe, expect, it } from "vitest";
import {
  isSnapshotFrame,
  snapshotAnswersGrid,
  snapshotGrid,
  snapshotGridMoved,
} from "./attach.ts";

const G = (cols: number, rows: number) => ({ cols, rows });

describe("snapshotAnswersGrid", () => {
  it("accepts a snapshot that answers the grid it was asked at", () => {
    expect(snapshotAnswersGrid(G(80, 24), G(80, 24))).toBe(true);
  });

  // The 66→65 column settle that blanked three panes at once.
  it("refuses a snapshot answering a grid the pane no longer has", () => {
    expect(snapshotAnswersGrid(G(66, 24), G(65, 24))).toBe(false);
    expect(snapshotAnswersGrid(G(80, 24), G(80, 25))).toBe(false);
  });

  // BOTH absences answer. Refusing on ignorance livelocks the reopen loop
  // against a pane that is not there — which is how this predicate's own error
  // path failed when it was first written to refuse.
  it("accepts when either side is unmeasured — ignorance is not evidence", () => {
    for (const absent of [null, undefined]) {
      expect(snapshotAnswersGrid(absent, G(80, 24))).toBe(true);
      expect(snapshotAnswersGrid(G(80, 24), absent)).toBe(true);
      expect(snapshotAnswersGrid(absent, absent)).toBe(true);
    }
  });

  // THE CASE THIS PREDICATE CANNOT SEE, pinned so nobody re-reads it as a
  // detector. `resizeTo` is last-attach-wins on a SHARED pty: another viewer
  // attaching at its own size reflows the terminal under you. But YOUR attach
  // asserted YOUR grid, so the snapshot you got answers the grid you asked at —
  // asked === current — and this rightly returns true. The damage arrives later
  // as reflowed BYTES with no frame to refuse. `./surface`'s multi-client
  // contract says the same thing and calls the re-wrap silent by construction.
  it("returns true for a foreign resize — it is not, and cannot be, a detector", () => {
    const askedAt = { cols: 120, rows: 40 };
    // We asked at 120x40 and got an answer at 120x40; a phone asserting 80x24
    // afterwards changes neither side of this comparison.
    expect(snapshotAnswersGrid(askedAt, askedAt)).toBe(true);
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
  const snap = (grid?: { cols: number; rows: number }) =>
    ({
      kind: "snapshot",
      data: "x",
      topLine: 0,
      ...(grid ? { grid } : {}),
    }) as const;

  it("reports the grid the bytes were serialized at", () => {
    expect(snapshotGrid(snap({ cols: 100, rows: 30 }))).toEqual({
      cols: 100,
      rows: 30,
    });
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

describe("snapshotGridMoved — the foreign-resize detector", () => {
  const snap = (grid?: { cols: number; rows: number }) =>
    ({
      kind: "snapshot",
      data: "x",
      topLine: 0,
      ...(grid ? { grid } : {}),
    }) as const;

  // THE CASE snapshotAnswersGrid structurally cannot see: we asked at 120x40,
  // another viewer holds the pty at 80x24, and the bytes came back serialized
  // at THEIRS. Two local measurements agree; the wire disagrees.
  it("sees the resize that two local measurements cannot", () => {
    expect(
      snapshotGridMoved(snap({ cols: 80, rows: 24 }), { cols: 120, rows: 40 }),
    ).toBe(true);
  });

  it("is quiet when the served grid is the asked grid", () => {
    expect(
      snapshotGridMoved(snap({ cols: 120, rows: 40 }), { cols: 120, rows: 40 }),
    ).toBe(false);
  });

  // A detector that fired on silence would light permanently against a 5.4
  // padi, which is worse than not detecting at all.
  it("stays quiet on absence — ignorance is not evidence", () => {
    expect(snapshotGridMoved(snap(), { cols: 120, rows: 40 })).toBe(false);
    expect(snapshotGridMoved(snap({ cols: 80, rows: 24 }), undefined)).toBe(
      false,
    );
    expect(snapshotGridMoved(snap(), null)).toBe(false);
  });
});
