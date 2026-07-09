/** srid's live split-loss repro, at the placement-decision level.
 *
 *  Scenario: host A has a split arrangement (2 tiles with saved `canvasLayout`).
 *  Switch to B, then back to A. On switch-back the tile list re-keys to A's ids
 *  BEFORE A's per-terminal metadata (carrying `canvasLayout`) re-arrives — so for
 *  a beat A's tiles have no resolved layout AND no metadata record. The old
 *  effect stamped a DEFAULT layout on them and persisted it (`onLayoutChange`),
 *  destroying the saved split. The fix: DEFER a no-layout tile whose metadata
 *  record hasn't arrived — it can't be told apart from a returning tile whose
 *  saved layout is still loading. */

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
    // A's tiles are back in the list, but their canvasLayout metadata is still in
    // flight — no resolved layout, no metadata record yet.
    const plan = planTilePlacements(
      [A1, A2],
      () => undefined, // layout not resolved yet
      () => false, // metadata record not arrived yet
    );
    // MUST defer — NOT default-place (which would persist a default and clobber
    // the saved split). The old effect would have classified these as "new".
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
      () => undefined, // no layout
      () => true, // record HAS arrived → genuinely new, not a returning tile
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
