/** Sleeping-terminals steps — sleep the active tile, wake the dormant one, and
 *  count live vs. sleeping tiles. A sleeping tile is rendered through the SAME
 *  `canvas-tile` shell as a live one, so the two are told apart by the presence
 *  of the dormant body's Wake button (`sleeping-tile-wake`). */

import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { LOCAL_LOCATION } from "kolu-common/surface";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TILE = '[data-testid="canvas-tile"]';
const SLEEP_BTN = '[data-testid="tile-sleep"]';
const WAKE_BTN = '[data-testid="sleeping-tile-wake"]';

Given(
  "a corrupt sleeping record already exists",
  async function (this: KoluWorld) {
    // An ORPHAN record — its root id matches no terminal in its own tree (the
    // legacy UUID-keyed format). ONE such record used to fail the whole
    // `sleepingTerminals` cell validation, so the client saw an empty cell and
    // every sleep "vanished". Seeding it proves the runtime filter drops it
    // gracefully and the rest of the feature keeps working. (Before the fix, the
    // schema `.refine` made this very `test__set` POST a 400, so the step itself
    // would fail — exactly the regression this guards.)
    const orphan = {
      id: "00000000-0000-4000-8000-000000000000",
      sleptAt: Date.now(),
      terminals: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          cwd: "/tmp",
          git: null,
          location: LOCAL_LOCATION,
        },
      ],
    };
    const resp = await this.page.request.fetch(
      "/rpc/surface/kolu/sleepingTerminals/test__set",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ json: [orphan] }),
      },
    );
    assert.ok(
      resp.ok(),
      `seeding the corrupt sleeping record failed: ${resp.status()}`,
    );
    await this.waitForFrame();
  },
);

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

When("I discard the sleeping terminal", async function (this: KoluWorld) {
  // The dormant tile's × (CanvasTile close) drops the record without waking.
  const sleepingTile = this.page.locator(TILE, {
    has: this.page.locator(WAKE_BTN),
  });
  await sleepingTile.locator('[data-testid="canvas-tile-close"]').click();
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
  "there should be {int} sleeping dock row(s)",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (n) =>
        document.querySelectorAll(
          '[data-testid="dock-row"][data-bucket="sleeping"]',
        ).length === n,
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
