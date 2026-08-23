import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  activeTileOf,
  type TerminalFocus,
  type LivePlacement,
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

  it("uses the live parent for a one-hop split", () => {
    const placementOf = (id: TerminalId): LivePlacement => {
      if (id === SUB) return { kind: "split", parentId: TILE_A };
      if (id === TILE_A) return { kind: "top-level" };
      return { kind: "missing" };
    };
    expect(activeTileOf(focus, placementOf)).toBe(TILE_A);
  });

  it("walks a nested chain to the root tile (not the middle parent)", () => {
    const MID = "mid" as TerminalId;
    const GRAND = "grand" as TerminalId;
    const nestedFocus: TerminalFocus = { id: GRAND, tileHint: TILE_A };
    const placementOf = (id: TerminalId): LivePlacement => {
      if (id === GRAND) return { kind: "split", parentId: MID };
      if (id === MID) return { kind: "split", parentId: TILE_A };
      if (id === TILE_A) return { kind: "top-level" };
      return { kind: "missing" };
    };
    expect(activeTileOf(nestedFocus, placementOf)).toBe(TILE_A);
  });

  it("lets streamed re-parenting override the write-time hint", () => {
    let placement: LivePlacement = { kind: "missing" };
    const placementOf = (id: TerminalId): LivePlacement => {
      if (id === SUB) return placement;
      if (id === TILE_A || id === TILE_B) return { kind: "top-level" };
      return { kind: "missing" };
    };

    expect(activeTileOf(focus, placementOf)).toBe(TILE_A);
    placement = { kind: "split", parentId: TILE_B };
    expect(activeTileOf(focus, placementOf)).toBe(TILE_B);
  });
});
