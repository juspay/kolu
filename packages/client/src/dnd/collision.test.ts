import { sortCollisions } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/collision";
import { Rectangle } from "@dnd-kit/geometry";
import { describe, expect, it } from "vitest";
import { nearestCenter } from "./collision";

type Point = { x: number; y: number };
type DetectorInput = Parameters<CollisionDetector>[0];

/** A 10×10 box centred on `center`. */
function box(center: Point): Rectangle {
  return new Rectangle(center.x - 5, center.y - 5, 10, 10);
}

/** What a drag resolves to: every droppable asked through `nearestCenter`,
 *  the answers ranked the way dnd-kit ranks them. Only the fields the rule
 *  could read are faked: the dragged shape, the pointer, each droppable's
 *  shape. */
function resolve(
  dragged: { at: Point; pointer: Point },
  droppables: { id: string; at: Point }[],
): string | null {
  const dragOperation = {
    shape: { current: box(dragged.at) },
    position: { current: dragged.pointer },
  } as unknown as DetectorInput["dragOperation"];
  const [first] = droppables
    .map((d) =>
      nearestCenter({
        dragOperation,
        droppable: {
          id: d.id,
          shape: box(d.at),
        } as unknown as DetectorInput["droppable"],
      }),
    )
    .filter((c) => c !== null)
    .sort(sortCollisions);
  return first === undefined ? null : String(first.id);
}

describe("nearestCenter", () => {
  it("resolves from the dragged element's centre, not from the pointer", () => {
    // A dock row is dragged by the grip at its right edge, so the pointer
    // rides well to the right of the row it carries. The droppable nearest
    // the CARRIED element wins, even when the pointer is over another one.
    const chosen = resolve({ at: { x: 0, y: 0 }, pointer: { x: 100, y: 0 } }, [
      { id: "near", at: { x: 20, y: 0 } },
      { id: "under-pointer", at: { x: 100, y: 0 } },
    ]);
    expect(chosen).toBe("near");
  });
});
