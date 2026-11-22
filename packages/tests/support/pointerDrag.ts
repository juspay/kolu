/** One real mouse drag, at the exact protocol level kolu's drag gestures
 *  share: press the SOURCE's center, step the pointer to a target point,
 *  release.
 *
 *  Stepped so the pointermove listeners see real frames — solid-dnd's
 *  PointerSensor (250 ms / 10 px activation) needs the drag to live in the DOM
 *  the way a user's does. Both in-canvas gestures (resize, selection,
 *  rearrange) and the dock's gestures feed the same engine. The dock
 *  features (dock_arrange_steps, dock_steps's resize) and the Code view's
 *  split handles were migrated off hand-spelled frames onto this driver; the
 *  canvas drivers spell them the old way until they adopt it. */

import type { KoluWorld } from "./world.ts";

/** Press the center of `fromSelector`, step the pointer by (dx, dy), release.
 *  The generic half: a target-point drag like the dock's resize. */
export async function dragFromCenter(
  world: KoluWorld,
  fromSelector: string,
  dx: number,
  dy: number,
  opts: { steps?: number } = {},
): Promise<void> {
  const from = world.page.locator(fromSelector);
  await from.waitFor({ state: "visible", timeout: 10000 });
  const fromBox = await from.boundingBox();
  if (!fromBox) throw new Error(`${fromSelector} has no bounding box`);
  const cx = fromBox.x + fromBox.width / 2;
  const cy = fromBox.y + fromBox.height / 2;
  await world.page.mouse.move(cx, cy);
  await world.page.mouse.down();
  await world.page.mouse.move(cx + dx, cy + dy, { steps: opts.steps ?? 16 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

/** The center-to-center case: a drop onto `toSelector` — solid-dnd's
 *  closestCenter collision resolves the droppable from the point, so the
 *  pointer must settle inside the target's box. */
export async function dragCenterTo(
  world: KoluWorld,
  fromSelector: string,
  toSelector: string,
  opts: { steps?: number } = {},
): Promise<void> {
  const to = world.page.locator(toSelector);
  await to.waitFor({ state: "visible", timeout: 10000 });
  const toBox = await to.boundingBox();
  if (!toBox) throw new Error(`${toSelector} has no bounding box`);
  const from = world.page.locator(fromSelector);
  await from.waitFor({ state: "visible", timeout: 10000 });
  const fromBox = await from.boundingBox();
  if (!fromBox) throw new Error(`${fromSelector} has no bounding box`);
  await dragFromCenter(
    world,
    fromSelector,
    toBox.x + toBox.width / 2 - (fromBox.x + fromBox.width / 2),
    toBox.y + toBox.height / 2 - (fromBox.y + fromBox.height / 2),
    opts,
  );
}

/** Drag a Corvu resize handle `pixels` along `axis` (negative is up / left).
 *  A handle is a zero-size line whose `::before` draws the hit area, so
 *  Playwright's visibility-gated `boundingBox()`/`dragTo()` cannot drive it:
 *  read its rect in the page and press its middle. */
export async function dragResizeHandle(
  world: KoluWorld,
  handleSelector: string,
  axis: "x" | "y",
  pixels: number,
): Promise<void> {
  const handle = world.page.locator(handleSelector);
  await handle.waitFor({ state: "attached", timeout: 10000 });
  const rect = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await world.page.mouse.move(x, y);
  await world.page.mouse.down();
  await world.page.mouse.move(
    axis === "x" ? x + pixels : x,
    axis === "y" ? y + pixels : y,
    { steps: 5 },
  );
  await world.page.mouse.up();
  await world.waitForFrame();
}
