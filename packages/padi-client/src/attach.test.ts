/** The `terminalAttach` consumer contract, pinned.
 *
 *  These are not spot-checks of a three-line predicate. Each case is a shape
 *  that cost a production incident, and the reason the rule ships with the
 *  stream rather than with whichever app learned it.
 *
 *  What is pinned here is rule 1: the STREAM owns the consumer's terminal size.
 *  Two frames state a size and a consumer must obey both — covering `snapshot`
 *  while forgetting `resized` leaves a pane painting bytes at a width nothing
 *  told it about, which is exactly the shape the old "refuse a mismatched
 *  snapshot" rule could not see (a foreign resize mid-stream sent no snapshot
 *  at all). `frameGrid` is the one reading, so that mistake is not spellable. */

import { describe, expect, it } from "vitest";
import { frameGrid, isResizedFrame, isSnapshotFrame } from "./attach.ts";

const snap = (grid: { cols: number; rows: number }) =>
  ({ kind: "snapshot", data: "x", topLine: 0, grid }) as const;
const delta = { kind: "delta", data: "bytes" } as const;
const resized = (grid: { cols: number; rows: number }) =>
  ({ kind: "resized", grid }) as const;

describe("frameGrid — the one size reading", () => {
  it("reads a snapshot's own grid: the layout its bytes are in", () => {
    // A snapshot is bytes already laid out for one cols×rows. Sizing to this
    // and then painting is what makes "these bytes fit this screen" true by
    // construction rather than by a check somebody has to remember.
    expect(frameGrid(snap({ cols: 120, rows: 40 }))).toEqual({
      cols: 120,
      rows: 40,
    });
  });

  it("reads a resize's grid: the size the pty's mirror moved to, here", () => {
    // THE case no snapshot-shaped rule could reach. A second viewer attaching
    // at its own size, or this pane's own publish landing a settle window after
    // its box moved, produces no snapshot — only this frame, whose position in
    // the stream is the fact it carries.
    expect(frameGrid(resized({ cols: 80, rows: 24 }))).toEqual({
      cols: 80,
      rows: 24,
    });
  });

  it("reads nothing off a delta — bytes change no size", () => {
    expect(frameGrid(delta)).toBeUndefined();
  });
});

describe("isSnapshotFrame", () => {
  it("narrows to the arm that carries a screen and a backfill seed", () => {
    const frame = snap({ cols: 80, rows: 24 });
    expect(isSnapshotFrame(frame)).toBe(true);
    if (!isSnapshotFrame(frame)) throw new Error("expected a snapshot frame");
    expect(frame.topLine).toBe(0);
  });

  it("is false for the two frames that carry no screen", () => {
    expect(isSnapshotFrame(delta)).toBe(false);
    expect(isSnapshotFrame(resized({ cols: 80, rows: 24 }))).toBe(false);
  });
});

describe("isResizedFrame", () => {
  it("narrows to the control arm, which has no bytes to write", () => {
    const frame = resized({ cols: 100, rows: 30 });
    expect(isResizedFrame(frame)).toBe(true);
    if (!isResizedFrame(frame)) throw new Error("expected a resized frame");
    expect(frame.grid).toEqual({ cols: 100, rows: 30 });
  });

  it("is false for a snapshot, which states a size AND paints", () => {
    // Both state a size, so a consumer that discriminated on "does it have a
    // grid" would write a snapshot's bytes twice or not at all. The two
    // questions — what size, and is there a screen — are separate predicates.
    expect(isResizedFrame(snap({ cols: 80, rows: 24 }))).toBe(false);
    expect(isResizedFrame(delta)).toBe(false);
  });
});
