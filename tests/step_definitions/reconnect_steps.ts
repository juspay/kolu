/**
 * Steps for the WebSocket reconnect regression (issue #410).
 *
 * Drives the client's PartySocket instance directly via the `window.__koluWs`
 * test hook exposed by `client/src/rpc.ts`. We tried CDP
 * `Network.emulateNetworkConditions` first — it doesn't reliably close
 * live WebSockets in headless Chromium, so the status never flipped to
 * "closed" and the test couldn't even reach the reconnect step.
 */

import { When, Then } from "@cucumber/cucumber";
import type { Page } from "playwright";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Poll until the header's data-ws-status attribute equals the expected value. */
function waitForWsStatus(page: Page, expected: string): Promise<unknown> {
  return page.waitForFunction(
    (want) =>
      document
        .querySelector("[data-ws-status]")
        ?.getAttribute("data-ws-status") === want,
    expected,
    { timeout: POLL_TIMEOUT },
  );
}

When("the WebSocket connection drops", async function (this: KoluWorld) {
  // PartySocket.close() halts auto-reconnect until reconnect() is called.
  await this.page.evaluate(() => {
    const w = window as Window & { __koluWs?: { close: () => void } };
    w.__koluWs?.close();
  });
  await waitForWsStatus(this.page, "closed");
});

When("the WebSocket connection is restored", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    const w = window as Window & { __koluWs?: { reconnect: () => void } };
    w.__koluWs?.reconnect();
  });
});

Then(
  "the connection status should eventually be {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForWsStatus(this.page, expected);
  },
);
