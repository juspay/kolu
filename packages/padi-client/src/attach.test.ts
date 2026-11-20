import { describe, expect, it } from "vitest";
import { frameGrid, isResizedFrame, isSnapshotFrame } from "./attach.ts";

const snap = (grid: { cols: number; rows: number }) =>
  ({ kind: "snapshot", data: "x", topLine: 0, grid }) as const;
const delta = { kind: "delta", data: "bytes" } as const;
const resized = (grid: { cols: number; rows: number }) =>
  ({ kind: "resized", grid }) as const;

describe("frameGrid — the one size reading", () => {
  it("reads a snapshot's own grid: the layout its bytes are in", () => {
    expect(frameGrid(snap({ cols: 120, rows: 40 }))).toEqual({
      cols: 120,
      rows: 40,
    });
  });

  it("reads a resize's grid: the size the pty's mirror moved to, here", () => {
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
    expect(isResizedFrame(snap({ cols: 80, rows: 24 }))).toBe(false);
    expect(isResizedFrame(delta)).toBe(false);
  });
});
