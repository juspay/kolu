/** Sleeping-terminals steps — sleep the active tile, wake the dormant one, and
 *  count live vs. sleeping tiles. A sleeping tile is rendered through the SAME
 *  `canvas-tile` shell as a live one, so the two are told apart by the presence
 *  of the dormant body's Wake button (`sleeping-tile-wake`). */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TILE = '[data-testid="canvas-tile"]';
const SLEEP_BTN = '[data-testid="tile-sleep"]';
const WAKE_BTN = '[data-testid="sleeping-tile-wake"]';

When("I sleep the active terminal", async function (this: KoluWorld) {
  await this.page.locator(`${TILE}[data-active="true"] ${SLEEP_BTN}`).click();
  // Sleep persists the snapshot, then tears down the live terminal; the dormant
  // tile (carrying its Wake button) takes its place once the record yields.
  await this.page
    .locator(WAKE_BTN)
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await this.waitForFrame();
});

When("I wake the sleeping terminal", async function (this: KoluWorld) {
  await this.page.locator(WAKE_BTN).first().click();
  // Wake respawns the tree (fresh ids) through the restore path and drops the
  // record, so the dormant tile and its Wake button go away.
  await this.page
    .locator(WAKE_BTN)
    .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  await this.waitForFrame();
});

Then(
  "there should be {int} sleeping tile(s)",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (n) =>
        document.querySelectorAll('[data-testid="sleeping-tile-wake"]')
          .length === n,
      count,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "there should be {int} live tile(s)",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (n) => {
        const tiles = Array.from(
          document.querySelectorAll('[data-testid="canvas-tile"]'),
        );
        const live = tiles.filter(
          (t) => !t.querySelector('[data-testid="sleeping-tile-wake"]'),
        );
        return live.length === n;
      },
      count,
      { timeout: POLL_TIMEOUT },
    );
  },
);
