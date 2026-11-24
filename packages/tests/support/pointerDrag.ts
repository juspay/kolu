/** One real mouse drag, at the exact protocol level kolu's drag gestures
 *  share: press the SOURCE's center, step the pointer to a target point,
 *  release.
 *
 *  Stepped so the pointermove listeners see real frames — kolu's drag
 *  scopes run dnd-kit's PointerSensor (10 px activation, moves applied once
 *  per animation frame), which needs the drag to live in the DOM the way a
 *  user's does. Both in-canvas gestures (resize, selection,
 *  rearrange) and the dock's gestures feed the same engine. The dock
 *  features (dock_arrange_steps, dock_steps's resize) and the Code view's
 *  split handles were migrated off hand-spelled frames onto this driver; the
 *  canvas drivers spell them the old way until they adopt it. */

import { type KoluWorld, POLL_TIMEOUT } from "./world.ts";

/** Press at (x, y), step the pointer by (dx, dy), release, and let a frame
 *  land: the one drag every driver below performs. */
async function pressAndDrag(
  world: KoluWorld,
  x: number,
  y: number,
  dx: number,
  dy: number,
  steps: number,
): Promise<void> {
  await world.page.mouse.move(x, y);
  await world.page.mouse.down();
  await world.page.mouse.move(x + dx, y + dy, { steps });
  await world.page.mouse.up();
  await world.waitForFrame();
}

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
  await pressAndDrag(
    world,
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2,
    dx,
    dy,
    opts.steps ?? 16,
  );
}

/** The center-to-center case: a drop onto `toSelector` — the drag scopes
 *  resolve to the droppable whose centre is nearest the dragged element's
 *  centre, so pressing the source's centre and stepping to the target's
 *  centre carries the one onto the other. */
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

/** Drag a Corvu resize handle by (dx, dy). A handle is a zero-size line whose
 *  `::before` draws the hit area, so Playwright's visibility-gated
 *  `boundingBox()` cannot find it: its middle is read from its rect in the
 *  page instead. */
export async function dragResizeHandle(
  world: KoluWorld,
  handleSelector: string,
  dx: number,
  dy: number,
): Promise<void> {
  const handle = world.page.locator(handleSelector);
  await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  const r = await handle.evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
  await pressAndDrag(world, r.x + r.width / 2, r.y + r.height / 2, dx, dy, 5);
}
