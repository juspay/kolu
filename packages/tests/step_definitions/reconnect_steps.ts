/**
 * Steps for the WebSocket reconnect regression (issue #410).
 *
 * Drives the client's wire directly via the `window.__koluWire` test hook
 * (a `WatchableWire`) exposed by `client/src/wire.ts`. We tried CDP
 * `Network.emulateNetworkConditions` first — it doesn't reliably close
 * live WebSockets in headless Chromium, so the status never flipped and
 * the test couldn't even reach the reconnect step.
 *
 * Under the Effect link there is no partysocket-style "close and stay closed
 * until told otherwise" transport state: the link owns its retry schedule and
 * always re-dials. So "drops" severs the current socket with
 * `forceReconnect()` and proves the severance was actually observed (the
 * status left "open" synchronously — not an unconditional pass), and
 * "restored" waits for the link's own re-dial to bring the wire back to
 * "open". The feature's Then steps then prove the UI plumbing and that
 * terminal streams flow again end-to-end.
 */

import { Then, When } from "@cucumber/cucumber";
import type { Page } from "playwright";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

type WireStatus = "connecting" | "open" | "closed" | "retired";
type TestWire = {
  status: () => WireStatus;
  forceReconnect: () => void;
};

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
  const observed = await this.page.evaluate(() => {
    const w = window as Window & { __koluWire?: TestWire };
    if (!w.__koluWire) throw new Error("window.__koluWire hook is absent");
    // forceReconnect severs the current socket synchronously (the link's
    // half-open recovery action), then re-dials on its own schedule.
    w.__koluWire.forceReconnect();
    return w.__koluWire.status();
  });
  // Prove the drop was real: the wire must have left "open" at the moment of
  // severance. (It may already be re-dialing — that's fine; "restored" and the
  // feature's Then steps own the recovery half.)
  if (observed === "open") {
    throw new Error(
      `forceReconnect() did not sever the wire — status stayed "${observed}"`,
    );
  }
});

When("the WebSocket connection is restored", async function (this: KoluWorld) {
  // The link re-dials on its own; restoration is proven, not performed.
  await this.page.waitForFunction(
    () => {
      const w = window as Window & { __koluWire?: TestWire };
      return w.__koluWire?.status() === "open";
    },
    undefined,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the connection status should eventually be {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForWsStatus(this.page, expected);
  },
);
