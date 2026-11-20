import { describe, expect, it } from "vitest";
import type { TileId } from "../tile/tileContent";
import type { TileLayout } from "./TileLayout";
import { planTilePlacements } from "./tilePlacementPlan";

const L = (x: number): TileLayout => ({ x, y: 0, w: 800, h: 540 });
const A1 = "A1" as TileId;
const A2 = "A2" as TileId;
const NEW = "NEW" as TileId;

describe("planTilePlacements — switch-back must not clobber a returning tile", () => {
  it("DEFERS a returning tile whose metadata record hasn't re-arrived (the split-loss bug)", () => {
    const plan = planTilePlacements(
      [A1, A2],
      () => undefined,
      () => false,
    );
    expect(plan.every((p) => p.kind === "defer")).toBe(true);
    expect(plan.some((p) => p.kind === "new")).toBe(false);
  });

  it("keeps a returning tile once its saved layout has resolved", () => {
    const saved: Record<string, TileLayout> = { A1: L(0), A2: L(900) };
    const plan = planTilePlacements(
      [A1, A2],
      (id) => saved[id],
      () => true,
    );
    expect(plan).toEqual([
      { id: A1, kind: "existing", layout: L(0) },
      { id: A2, kind: "existing", layout: L(900) },
    ]);
  });

  it("still default-places a genuinely-new tile (record arrived, no saved layout)", () => {
    const plan = planTilePlacements(
      [NEW],
      () => undefined,
      () => true,
    );
    expect(plan).toEqual([{ id: NEW, kind: "new" }]);
  });

  it("mixed: an existing tile kept, a new tile placed, a pending tile deferred", () => {
    const saved: Record<string, TileLayout> = { A1: L(0) };
    const records: Record<string, boolean> = { A1: true, NEW: true, A2: false };
    const plan = planTilePlacements(
      [A1, NEW, A2],
      (id) => saved[id],
      (id) => records[id] ?? false,
    );
    expect(plan.map((p) => p.kind)).toEqual(["existing", "new", "defer"]);
  });
});
