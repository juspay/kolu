/**
 * Steps for the PTY-host daemon update-pending nudge + restart (#951 R4c).
 *
 * The nudge fires when the surviving daemon's build id differs from the
 * server's. We reproduce that by restarting kolu-server with a
 * `KOLU_BUILD_ID_OVERRIDE` — the daemon (spawned by the prior server) keeps
 * its old id, so the fresh server flags it stale. Restarting the daemon via
 * the nudge spawns a fresh one under the override server, so the ids match
 * again and the nudge clears.
 */

import { Then, When } from "@cucumber/cucumber";
import { restartKoluServer } from "../support/hooks.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const NUDGE = '[data-testid="pty-update-pending"]';

When(
  "the kolu server restarts as a newer build",
  async function (this: KoluWorld) {
    await restartKoluServer({ KOLU_BUILD_ID_OVERRIDE: "newer-build" });
  },
);

Then(
  "the update-pending nudge should appear",
  async function (this: KoluWorld) {
    // Just a client re-subscribe to the daemonStatus cell after reconnect — the
    // daemon is already up (only stale), so POLL_TIMEOUT is ample.
    await this.page
      .locator(NUDGE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I restart the local PTY daemon via the nudge",
  async function (this: KoluWorld) {
    await this.page.locator(NUDGE).click();
    await this.page
      .locator('[data-testid="daemon-restart-confirm"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator('[data-testid="daemon-restart-confirm-button"]')
      .click();
  },
);

Then(
  "the update-pending nudge should disappear",
  async function (this: KoluWorld) {
    // The restart RPC awaits a fresh daemon spawn (a tsx cold start), so allow
    // the longer hydration window rather than the poll window.
    await this.page
      .locator(NUDGE)
      .waitFor({ state: "hidden", timeout: HYDRATION_TIMEOUT });
  },
);

Then("there should be no terminals", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    () =>
      document.querySelectorAll('[data-testid="canvas-tile"][data-terminal-id]')
        .length === 0,
    undefined,
    { timeout: HYDRATION_TIMEOUT },
  );
});
