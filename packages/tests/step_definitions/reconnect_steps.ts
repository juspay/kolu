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
  onStatus: (cb: (s: WireStatus) => void) => () => void;
  forceReconnect: () => void;
};
/** The page-side globals this file installs: the wire hook `client/src/wire.ts`
 *  publishes, plus the one-shot severance flag the drop step arms. */
type WireWindow = Window & {
  __koluWire?: TestWire;
  __koluWireSevered?: boolean;
};

/** Poll until the header's data-ws-status attribute equals the expected value.
 *  On timeout, quote what the header ACTUALLY read and what the transport under it
 *  reported — the two can disagree (the UI derives its dot from the lifecycle, not
 *  from the socket), and "timed out" alone doesn't say which half broke. */
async function waitForWsStatus(page: Page, expected: string): Promise<void> {
  await page
    .waitForFunction(
      (want) =>
        document
          .querySelector("[data-ws-status]")
          ?.getAttribute("data-ws-status") === want,
      expected,
      { timeout: POLL_TIMEOUT },
    )
    .catch(async () => {
      const seen = await page.evaluate(() => ({
        header:
          document
            .querySelector("[data-ws-status]")
            ?.getAttribute("data-ws-status") ?? "(no [data-ws-status] element)",
        wire: (window as WireWindow).__koluWire?.status() ?? "(no wire hook)",
      }));
      throw new Error(
        `connection status never became "${expected}" — the header read "${seen.header}" while the wire read "${seen.wire}"`,
      );
    });
}

/** Wait for the wire to report `open` — the precondition for severing it, and the
 *  proof of restoration afterwards. */
function waitForWireOpen(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => (window as WireWindow).__koluWire?.status() === "open",
    undefined,
    { timeout: POLL_TIMEOUT },
  );
}

When("the WebSocket connection drops", async function (this: KoluWorld) {
  // `forceReconnect()` is a no-op while a re-dial is already in flight (there is no
  // socket to sever), so start from a wire that is provably `open`. Without this the
  // step could "pass" by severing nothing during an unrelated blip.
  await waitForWireOpen(this.page);
  await this.page.evaluate(() => {
    const w = window as WireWindow;
    if (!w.__koluWire) throw new Error("window.__koluWire hook is absent");
    // Arm a status RECORDER *before* severing. `forceReconnect()` calls
    // `ws.close(1000)`, and the browser delivers the resulting `close` event on a
    // LATER task — so reading `status()` synchronously after the call always reads
    // the stale "open", and polling for the non-open window from Node can race
    // straight through it (the link re-dials ~500ms later). Subscribing to
    // `onStatus` cannot miss the transition.
    w.__koluWireSevered = false;
    const off = w.__koluWire.onStatus((s) => {
      if (s === "open") return;
      w.__koluWireSevered = true;
      off();
    });
    w.__koluWire.forceReconnect();
  });
  // Prove the drop was REAL: the wire must actually have left "open". A
  // `forceReconnect()` that severed nothing leaves the flag false and fails HERE,
  // quoting the transport — never later as a mystery missing terminal frame.
  await this.page
    .waitForFunction(
      () => (window as WireWindow).__koluWireSevered === true,
      undefined,
      { timeout: POLL_TIMEOUT },
    )
    .catch(() => {
      throw new Error(
        'forceReconnect() did not sever the wire — its status never left "open"',
      );
    });
});

When("the WebSocket connection is restored", async function (this: KoluWorld) {
  // The link re-dials on its own; restoration is proven, not performed.
  await waitForWireOpen(this.page);
});

Then(
  "the connection status should eventually be {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForWsStatus(this.page, expected);
  },
);
