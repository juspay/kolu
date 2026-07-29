import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  activeTileOf,
  type TerminalFocus,
  type TerminalPlacement,
} from "./focusedTerminal";

const TILE_A = "tile-a" as TerminalId;
const TILE_B = "tile-b" as TerminalId;
const SUB = "sub" as TerminalId;
const focus: TerminalFocus = { id: SUB, tileHint: TILE_A };

describe("activeTileOf", () => {
  it("returns no tile when no terminal is focused", () => {
    expect(activeTileOf(null, () => ({ kind: "missing" }))).toBeNull();
  });

  it("uses the write-time tile hint while metadata is missing", () => {
    expect(activeTileOf(focus, () => ({ kind: "missing" }))).toBe(TILE_A);
  });

  it("uses the focused id when live metadata says it is top-level", () => {
    expect(activeTileOf(focus, () => ({ kind: "top-level" }))).toBe(SUB);
  });

  it("uses the live parent for a split", () => {
    expect(
      activeTileOf(focus, () => ({ kind: "split", parentId: TILE_A })),
    ).toBe(TILE_A);
  });

  it("lets streamed re-parenting override the write-time hint", () => {
    let placement: TerminalPlacement = { kind: "missing" };
    const placementOf = () => placement;

    expect(activeTileOf(focus, placementOf)).toBe(TILE_A);
    placement = { kind: "split", parentId: TILE_B };
    expect(activeTileOf(focus, placementOf)).toBe(TILE_B);
  });

  it("is a pure one-read fold", () => {
    const placementOf = vi.fn(
      (): TerminalPlacement => ({ kind: "split", parentId: TILE_A }),
    );

    expect(activeTileOf(focus, placementOf)).toBe(TILE_A);
    expect(placementOf).toHaveBeenCalledExactlyOnceWith(SUB);
  });
});
