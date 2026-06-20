/** Sleeping terminals — Sleep/Wake step definitions.
 *
 *  Reuses the existing open-terminal / run / assert-row / close-confirm steps
 *  (terminal_steps, kill_steps, worktree_steps, session_restore_steps). New
 *  here: the ☾ Sleep click, the dormant Wake click, the four
 *  data-state="sleeping" presence assertions, the discard-confirm copy
 *  assertion, and the malformed-on-disk seed + reboot. */

import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  currentBaseUrl,
  seedMalformedSessionAndReboot,
} from "../support/hooks.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const SLEEPING_TILE_SELECTOR =
  '[data-testid="canvas-tile"][data-state="sleeping"]';

When(
  "I sleep the active terminal via the tile sleep button",
  async function (this: KoluWorld) {
    // node.click() (not a real-mouse click) to skip the stacked-tile hit-test:
    // the ☾ button lives on the active tile's title bar, so target that tile.
    await this.page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="canvas-tile"][data-active="true"] [data-testid="canvas-tile-sleep"]',
      );
      if (!btn) throw new Error("sleep button not found on the active tile");
      btn.click();
    });
    // Sleep MINTS a new id (records are immutable) and retires the old — wait
    // for the dormant-shape tile to appear, then re-stash the new id so a later
    // close-by-index resolves the live tile.
    await this.page.waitForFunction(
      (sel) => !!document.querySelector(sel),
      SLEEPING_TILE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
    const newId = await this.page.evaluate(
      (sel) =>
        document.querySelector(sel)?.getAttribute("data-terminal-id") ?? null,
      SLEEPING_TILE_SELECTOR,
    );
    if (newId) this.createdTerminalIds = [newId];
  },
);

When("I wake the active sleeping tile", async function (this: KoluWorld) {
  // The dormant body carries the explicit Wake CTA.
  await this.page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-testid="dormant-tile-body"] [data-testid="dormant-wake"]',
    );
    if (!btn) throw new Error("dormant Wake button not found");
    btn.click();
  });
  // Wake = restore-one: a fresh ACTIVE tile (new id) with a real xterm. Wait
  // for an active tile that is no longer sleeping and has an xterm screen.
  await this.page.waitForFunction(
    () => {
      const tile = document.querySelector(
        '[data-testid="canvas-tile"][data-active="true"]',
      );
      return (
        !!tile &&
        tile.getAttribute("data-state") !== "sleeping" &&
        !!tile.querySelector(".xterm-screen")
      );
    },
    undefined,
    { timeout: HYDRATION_TIMEOUT },
  );
  const newId = await this.page.evaluate(
    () =>
      document
        .querySelector('[data-testid="canvas-tile"][data-active="true"]')
        ?.getAttribute("data-terminal-id") ?? null,
  );
  if (newId) this.createdTerminalIds = [newId];
});

// --- presence assertions (one per surface, keyed on data-state="sleeping") ---

Then(
  "canvas tile {int} should be sleeping",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      (i) =>
        document
          .querySelectorAll('[data-testid="canvas-tile"]')
          [i - 1]?.getAttribute("data-state") === "sleeping",
      index,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} sleeping row(s)",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (c) =>
        document.querySelectorAll(
          '[data-testid="dock-row"][data-state="sleeping"]',
        ).length === c,
      count,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the minimap should show {int} sleeping marker(s)",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (c) =>
        document.querySelectorAll(
          '[data-testid="minimap-tile-rect"][data-state="sleeping"]',
        ).length === c,
      count,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the workspace switcher should show {int} sleeping entry/entries",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      (c) =>
        document.querySelectorAll(
          '[data-testid="workspace-switcher-card"][data-state="sleeping"]',
        ).length === c,
      count,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// --- close-as-discard ---

When("I confirm the close", async function (this: KoluWorld) {
  // A sleeping tile's git is null in these scenarios, so the dialog renders the
  // single close-all button (no worktree-removal split).
  await this.page.locator('[data-testid="close-confirm-close-all"]').click();
});

Then(
  "the close confirmation should read {string}",
  async function (this: KoluWorld, text: string) {
    const dialog = this.page.locator('[data-testid="close-confirm"]');
    await dialog.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const body = (await dialog.textContent()) ?? "";
    assert.ok(
      body.toLowerCase().includes(text.toLowerCase()),
      `close-confirm did not read "${text}", got "${body}"`,
    );
  },
);

// --- malformed-record tolerance ---

Given(
  "a malformed sleeping record and one good sleeping record on disk",
  async function (this: KoluWorld) {
    // Write the corrupt config.json (one VALID + one malformed sleeping record)
    // straight to disk and reboot the per-worker server so a fresh cold boot
    // reads it. The bad record must be dropped at the read boundary
    // (`tolerateSleepingRecord`) while the good one rehydrates — a single
    // malformed record must never poison the rest of the set.
    await seedMalformedSessionAndReboot();
  },
);

When("I open the rebooted app", async function (this: KoluWorld) {
  // The Given rebooted the server onto a FRESH random port, so a bare
  // `goto("/")` (resolved against the page context's captured baseURL) would hit
  // the dead old port. Navigate to the current absolute base URL instead.
  await this.page.goto(currentBaseUrl(), { waitUntil: "load" });
});

Then("the rebooted app should become usable", async function (this: KoluWorld) {
  // The corrupt sleeping record must be tolerated, not fatal. A sleeping-only
  // workspace stays on the canvas with NO live terminal and NO empty state, so
  // the generic `waitForReady` (xterm-screen | empty-state) wouldn't recognize
  // it. Waiting for the VALID sleeping record's dormant tile proves both that
  // the boot survived the malformed sibling AND that the good one rehydrated.
  await this.page
    .locator('[data-testid="canvas-tile"][data-state="sleeping"]')
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
});
