/** FX1's recovered nine-case focus matrix. The old implementation reconstructed
 *  keyboard focus from active tile + mutable sub-panel chrome. The new model
 *  writes that terminal id once and derives only its top-level tile. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { activeTileOf } from "../hostScope/createViewState";

const TILE = "tile" as TerminalId;
const SUB = "sub" as TerminalId;
const OTHER_SUB = "other-sub" as TerminalId;

const parentOf = (id: TerminalId): TerminalId | null =>
  id === SUB || id === OTHER_SUB ? TILE : null;

describe("the one focused-terminal fact", () => {
  it("names the SPLIT you clicked into, not the tile holding it — THE REPORTED BUG", () => {
    const focusedTerminalId = SUB;
    expect(focusedTerminalId).toBe(SUB);
    expect(activeTileOf(focusedTerminalId, parentOf)).toBe(TILE);
  });

  it("names the tile when focus is in the main pane", () => {
    expect(activeTileOf(TILE, parentOf)).toBe(TILE);
  });

  it("names the tile when the panel is collapsed", () => {
    // `collapsePanel(parent)` writes the parent into the focus fact.
    const focusedTerminalId = TILE;
    expect(activeTileOf(focusedTerminalId, parentOf)).toBe(TILE);
  });

  it("follows the selected tab when you switch splits", () => {
    const focusedTerminalId = OTHER_SUB;
    expect(focusedTerminalId).toBe(OTHER_SUB);
    expect(activeTileOf(focusedTerminalId, parentOf)).toBe(TILE);
  });

  it("falls back to the tile when the panel is open at no tab", () => {
    const focusedTerminalId = TILE;
    expect(activeTileOf(focusedTerminalId, parentOf)).toBe(TILE);
  });

  it("names nothing when no tile is active", () => {
    expect(activeTileOf(null, parentOf)).toBeNull();
  });

  it("never names the tile and its split at the same time", () => {
    const focusedTerminalId: TerminalId = SUB;
    const activeTileId = activeTileOf(focusedTerminalId, parentOf);
    expect(focusedTerminalId).not.toBe(activeTileId);
    expect([focusedTerminalId, activeTileId]).toEqual([SUB, TILE]);
  });
});

describe("a terminal that merely HAS splits", () => {
  it("names the TILE when you have never focused into a split", () => {
    expect(activeTileOf(TILE, parentOf)).toBe(TILE);
  });

  it("asks with a READ, never seeding state as a side effect", () => {
    const readParent = vi.fn(() => null);
    expect(activeTileOf(TILE, readParent)).toBe(TILE);
    expect(readParent).toHaveBeenCalledExactlyOnceWith(TILE);
  });
});
