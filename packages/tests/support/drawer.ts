import { type KoluWorld, POLL_TIMEOUT } from "./world.ts";

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
