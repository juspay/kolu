/**
 * Steps for the Inspector's Ports section (PRT1).
 *
 * The listener is a real `node -e … .listen(...)` in the real PTY, deliberately:
 * the whole point of this scenario is the path a mock cannot exercise — padi's
 * `/proc` join has to find the socket inside the terminal's OWN process subtree,
 * which means the process really must be a child of that shell.
 *
 * Waiting is generous on purpose. The scan is a 5 s baseline nudged by output, and
 * typing the command produces output — so the chip normally lands in about a
 * second. The budget is sized for the note's stated criterion ("within two scan
 * ticks") plus the surface round trip, so a loaded CI box does not read as a
 * broken sensor.
 */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Two 5 s scan ticks plus room for the surface round trip and a loaded box. */
const PORT_SCAN_TIMEOUT = 25_000;

/** The one-liner that binds a port. `-e` keeps it a single foreground process the
 *  shell owns directly, so Ctrl+C ends it and the subtree walk sees it as a child. */
function listenerCommand(port: number, host: string): string {
  return `node -e 'require("http").createServer((_,r)=>r.end("ok")).listen(${port},"${host}",()=>console.log("listening"))'`;
}

When(
  "I start a listener on port {int} bound to all interfaces",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(listenerCommand(port, "0.0.0.0"));
    await this.waitForFrame();
  },
);

When(
  "I start a listener on port {int} bound to loopback only",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(listenerCommand(port, "127.0.0.1"));
    await this.waitForFrame();
  },
);

When(
  "I start a listener on port {int} in the split terminal",
  async function (this: KoluWorld, port: number) {
    // A split is its own PTY with its own process subtree, so its ports are
    // attributed to IT, not to the tile's main pane. Typing here rather than
    // through `terminalRun` (which deliberately excludes `[data-sub-terminal]`)
    // is the whole point of the scenario.
    await this.focusForTyping("[data-sub-terminal]");
    await this.page.keyboard.type(listenerCommand(port, "0.0.0.0"));
    await this.page.keyboard.press("Enter");
    await this.waitForFrame();
  },
);

When("I stop the listener", async function (this: KoluWorld) {
  await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
  await this.page.keyboard.press("Control+c");
  await this.waitForFrame();
});

/** The section's rows, as `{ port, openable }` — read from the DOM rather than
 *  from a locator count, so a failure message can say what WAS there. */
async function portRows(
  world: KoluWorld,
): Promise<Array<{ port: number; openable: boolean }>> {
  return world.page.evaluate(() => {
    const section = document.querySelector('[data-testid="inspector-ports"]');
    if (section === null) return [];
    return [...section.querySelectorAll("[data-port]")].map((el) => ({
      port: Number(el.getAttribute("data-port")),
      openable: el.getAttribute("data-testid") === "inspector-port-open",
    }));
  });
}

Then(
  "the inspector should show an openable port chip for {int}",
  async function (this: KoluWorld, port: number) {
    // `pollFor` returns only when `isDone` holds and otherwise throws `onTimeout`,
    // so the predicate IS the assertion here — no trailing `assert` that cannot fail.
    await pollFor({
      observe: () => portRows(this),
      isDone: (rows) => rows.some((r) => r.port === port && r.openable),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected an openable chip for port ${port} within ${elapsedMs}ms; the Ports section showed ${JSON.stringify(last ?? [])}`,
        ),
    });
  },
);

Then(
  "the inspector should show port {int} as needing a forward",
  async function (this: KoluWorld, port: number) {
    // Present AND inert: a loopback port must be listed (that is the answer to
    // "what is this terminal serving?") but must not offer an open that would
    // reach the viewer's own machine instead of the server's.
    const rows = await pollFor({
      observe: () => portRows(this),
      isDone: (rows) => rows.some((r) => r.port === port),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} listed within ${elapsedMs}ms; the Ports section showed ${JSON.stringify(last ?? [])}`,
        ),
    });
    const row = rows.find((r) => r.port === port);
    assert.ok(row, `port ${port} was not listed`);
    assert.strictEqual(
      row.openable,
      false,
      `port ${port} is loopback-bound, so it must not offer a direct open`,
    );
  },
);

Then(
  "the inspector should stop showing port {int}",
  async function (this: KoluWorld, port: number) {
    await pollFor({
      observe: () => portRows(this),
      isDone: (rows) => !rows.some((r) => r.port === port),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} to leave the Ports section within ${elapsedMs}ms; it still showed ${JSON.stringify(last ?? [])}`,
        ),
    });
  },
);

Then(
  "the open link for port {int} should point at the page's own host",
  async function (this: KoluWorld, port: number) {
    // The chip is an anchor now, so the assertion is the URL kolu BUILT — no need to
    // trap `window.open` or open a real tab. What this pins is the hostname it does
    // NOT use: "localhost" in a link means the VIEWER's machine, which is the one box
    // certainly not running the dev server.
    const link = this.page.locator(
      `[data-testid="inspector-port-open"][data-port="${port}"]`,
    );
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const [href, hostname] = await Promise.all([
      link.getAttribute("href"),
      this.page.evaluate(() => window.location.hostname),
    ]);
    assert.strictEqual(href, `http://${hostname}:${port}`);
    assert.strictEqual(await link.getAttribute("target"), "_blank");
    // The security posture rides on the element, so it is worth pinning too.
    assert.strictEqual(await link.getAttribute("rel"), "noopener noreferrer");
  },
);
