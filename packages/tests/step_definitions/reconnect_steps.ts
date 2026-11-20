import { Then, When } from "@cucumber/cucumber";
import type { Page } from "playwright";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

type WireStatus = "connecting" | "open" | "closed" | "retired";
type TestWire = {
  status: () => WireStatus;
  onStatus: (cb: (s: WireStatus) => void) => () => void;
  forceReconnect: () => void;
};
type WireWindow = Window & {
  __koluWire?: TestWire;
  __koluWireSevered?: boolean;
};

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

function waitForWireOpen(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => (window as WireWindow).__koluWire?.status() === "open",
    undefined,
    { timeout: POLL_TIMEOUT },
  );
}

When("the WebSocket connection drops", async function (this: KoluWorld) {
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
  await waitForWireOpen(this.page);
});

Then(
  "the connection status should eventually be {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForWsStatus(this.page, expected);
  },
);
