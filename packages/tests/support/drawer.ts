/** Shared helpers for Corvu Drawer interactions in mobile e2e tests.
 *  Lives in `support/` rather than a specific `*_steps.ts` file so any
 *  drawer step file can import it without crossing into a peer step
 *  module — peer-imports between step files conflate "shared helper"
 *  with "step-author who happened to need it first." */

import { type KoluWorld, POLL_TIMEOUT } from "./world.ts";

/** Tap a Corvu Drawer's overlay at a point where Drawer.Content can't
 *  occlude it. The overlay spans the full viewport but the drawer's
 *  content sits on top of it across the anchor side; tap the opposite
 *  edge — that's the only region where the backdrop is actually
 *  receiving touches. */
export async function tapBackdropAtSafePoint(
  world: KoluWorld,
  selector: string,
  side: "top" | "bottom" | "left" | "right",
): Promise<void> {
  const backdrop = world.page.locator(selector);
  await backdrop.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const box = await backdrop.boundingBox();
  if (!box) throw new Error(`backdrop ${selector} has no bounding box`);
  const SAFE_OFFSET = 20;
  const positions = {
    top: { x: box.width / 2, y: box.height - SAFE_OFFSET },
    bottom: { x: box.width / 2, y: SAFE_OFFSET },
    left: { x: box.width - SAFE_OFFSET, y: box.height / 2 },
    right: { x: SAFE_OFFSET, y: box.height / 2 },
  };
  await backdrop.tap({ position: positions[side] });
  await world.waitForFrame();
}
