import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const PORT_SCAN_TIMEOUT = 25_000;

const LISTENER_START_TIMEOUT = 20_000;

function buildEchoProofMarker(halves: readonly [string, string]): {
  text: string;
  printedBy: string;
} {
  return {
    text: halves.join(""),
    printedBy: halves.map((half) => JSON.stringify(half)).join("+"),
  };
}

const LISTENING = buildEchoProofMarker(["kolu-e2e", "-listening"]);

function listenerCommand(port: number, host: string): string {
  return `'${process.execPath}' -e 'require("http").createServer((_,r)=>r.end("ok")).listen(${port},"${host}",()=>console.log(${LISTENING.printedBy}))'`;
}

async function waitForListening(
  world: KoluWorld,
  port: number,
  selector: string,
): Promise<void> {
  try {
    await waitForBufferContains(world.page, LISTENING.text, {
      selector,
      timeout: LISTENER_START_TIMEOUT,
    });
  } catch {
    const shown = await world.page.evaluate(
      (sel) => window.__readXtermBuffer?.(sel, 0) ?? "",
      selector,
    );
    throw new Error(
      `The listener on port ${port} never bound within ${LISTENER_START_TIMEOUT}ms — ` +
        `so this scenario cannot say anything about the port sensor. ` +
        `The terminal (${selector}) last showed:\n${shown.trimEnd().split("\n").slice(-12).join("\n")}`,
    );
  }
}

const MAIN_PANE = "[data-visible]:not([data-sub-terminal])";

When(
  "I start a listener on port {int} bound to all interfaces",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(listenerCommand(port, "0.0.0.0"));
    await waitForListening(this, port, MAIN_PANE);
  },
);

When(
  "I start a listener on port {int} bound to loopback only",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(listenerCommand(port, "127.0.0.1"));
    await waitForListening(this, port, MAIN_PANE);
  },
);

When(
  "I start a listener on port {int} bound to the v6 loopback only",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(listenerCommand(port, "::1"));
    await waitForListening(this, port, MAIN_PANE);
  },
);

When(
  "I start a listener on port {int} in the split terminal",
  async function (this: KoluWorld, port: number) {
    await this.focusForTyping("[data-sub-terminal]");
    await this.page.keyboard.type(listenerCommand(port, "0.0.0.0"));
    await this.page.keyboard.press("Enter");
    await waitForListening(this, port, "[data-sub-terminal]");
  },
);

When("I stop the listener", async function (this: KoluWorld) {
  await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
  await this.page.keyboard.press("Control+c");
  await this.waitForFrame();
});

interface PortsView {
  present: boolean;
  rows: Array<{ port: number; openable: boolean }>;
  forwardable: number[];
  badges: Array<{ port: number; localPort: number }>;
}

const PORTS_VIEW_SRC = `(() => {
  const section = document.querySelector('[data-testid="inspector-ports"]');
  if (section === null)
    return { present: false, rows: [], forwardable: [], badges: [] };
  const rows = [
    ...section.querySelectorAll('[data-testid="inspector-port-row"]'),
  ];
  const portOf = (row) => Number(row.getAttribute("data-port"));
  const partOf = (row, testid) =>
    row.querySelector('[data-testid="' + testid + '"]');
  const localPortOf = (row) => {
    // The LAST ":digits", because the pill carries a whole address and an
    // IPv6-served kolu puts colons in the host half ([fd7a::2]:61003).
    const text = partOf(row, "inspector-port-forward-badge")?.textContent ?? "";
    const named = /:(\\d+)$/.exec(text.trim())?.[1];
    return named === undefined ? portOf(row) : Number(named);
  };
  return {
    present: true,
    rows: rows.map((row) => ({
      port: portOf(row),
      openable: partOf(row, "inspector-port-open") !== null,
    })),
    forwardable: rows
      .filter((row) => partOf(row, "inspector-port-forward-open") !== null)
      .map(portOf),
    badges: rows
      .filter((row) => partOf(row, "inspector-port-forward-badge") !== null)
      .map((row) => ({ port: portOf(row), localPort: localPortOf(row) })),
  };
})()`;

async function portsView(world: KoluWorld): Promise<PortsView> {
  return world.page.evaluate<PortsView>(PORTS_VIEW_SRC);
}

async function forwardRows(
  world: KoluWorld,
): Promise<Array<{ port: number; origin: string }>> {
  return world.page.evaluate(() => {
    const section = document.querySelector('[data-testid="inspector-ports"]');
    if (section === null) return [];
    return [...section.querySelectorAll('[data-forwarded="yes"]')].map(
      (el) => ({
        port: Number(el.getAttribute("data-port")),
        origin: el.getAttribute("data-origin") ?? "",
      }),
    );
  });
}

function describeView(view: PortsView | undefined): string {
  if (view === undefined) return "the section was never read";
  if (!view.present) return "the Ports section was NOT RENDERED at all";
  if (view.rows.length === 0)
    return "the Ports section rendered but listed NO ports";
  return `the Ports section showed ${JSON.stringify(view.rows)}`;
}

Then(
  "the inspector should show an openable port chip for {int}",
  async function (this: KoluWorld, port: number) {
    await pollFor({
      observe: () => portsView(this),
      isDone: (view) => view.rows.some((r) => r.port === port && r.openable),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected an openable chip for port ${port} within ${elapsedMs}ms; ${describeView(last)}`,
        ),
    });
  },
);

Then(
  "the inspector should show port {int} as needing a forward",
  async function (this: KoluWorld, port: number) {
    const view = await pollFor({
      observe: () => portsView(this),
      isDone: (v) => v.rows.some((r) => r.port === port),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} listed within ${elapsedMs}ms; ${describeView(last)}`,
        ),
    });
    const row = view.rows.find((r) => r.port === port);
    assert.ok(row, `port ${port} was not listed`);
    assert.strictEqual(
      row.openable,
      false,
      `port ${port} is loopback-bound, so it must not offer a direct open`,
    );
    assert.ok(
      view.forwardable.includes(port),
      `port ${port} is loopback-bound, so it must offer "forward & open"; forwardable was ${JSON.stringify(view.forwardable)}`,
    );
  },
);

Then(
  "the inspector should stop showing port {int}",
  async function (this: KoluWorld, port: number) {
    await pollFor({
      observe: () => portsView(this),
      isDone: (view) => !view.rows.some((r) => r.port === port),
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} to leave the Ports section within ${elapsedMs}ms; ${describeView(last)}`,
        ),
    });
  },
);

Then(
  "the open link for port {int} should point at the page's own host",
  async function (this: KoluWorld, port: number) {
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
    assert.strictEqual(await link.getAttribute("rel"), "noopener noreferrer");
  },
);

const FORWARD_TIMEOUT = 15_000;

When(
  "I click forward-and-open for port {int}",
  async function (this: KoluWorld, port: number) {
    const button = this.page.locator(
      `[data-testid="inspector-port-forward-open"][data-port="${port}"]`,
    );
    await button.waitFor({ state: "visible", timeout: PORT_SCAN_TIMEOUT });
    const popup = this.context.waitForEvent("page", {
      timeout: FORWARD_TIMEOUT,
    });
    await button.click();
    this.externalPopup = await popup;
  },
);

Then(
  "the forwarded tab should load the listener's page",
  async function (this: KoluWorld) {
    const popup = this.externalPopup;
    assert.ok(popup, "no forwarded tab was captured");
    await pollFor({
      observe: async () => {
        try {
          return await popup.evaluate(() => document.body?.textContent ?? "");
        } catch {
          return "";
        }
      },
      isDone: (body) => body.includes("ok"),
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `The forwarded tab never showed the listener's body within ${elapsedMs}ms — ` +
            `it is at ${popup.url()} showing ${JSON.stringify(last)}`,
        ),
    });
    const url = new URL(popup.url());
    const hostname = await this.page.evaluate(() => window.location.hostname);
    assert.strictEqual(url.hostname, hostname.replace(/^\[|\]$/g, ""));
    this.forwardedUrl = popup.url();
  },
);

Then(
  "the inspector should show a forward badge for port {int}",
  async function (this: KoluWorld, port: number) {
    const view = await pollFor({
      observe: () => portsView(this),
      isDone: (v) => v.badges.some((b) => b.port === port),
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected a ⇄ badge on port ${port} within ${elapsedMs}ms; ${describeView(last)}`,
        ),
    });
    const badge = view.badges.find((b) => b.port === port);
    assert.ok(badge, `no badge for port ${port}`);
    assert.notStrictEqual(
      badge.localPort,
      port,
      `the badge names port ${port}, the same one the server bound — a relay must listen on a different number`,
    );
    assert.ok(badge.localPort > 0, "the badge names no local port");
  },
);

Then(
  "the ports section should show port {int} as forwarded",
  async function (this: KoluWorld, port: number) {
    const rows = await pollFor({
      observe: () => forwardRows(this),
      isDone: (r) => r.some((row) => row.port === port),
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} in Forwarded Ports within ${elapsedMs}ms; saw ${JSON.stringify(last)}`,
        ),
    });
    assert.strictEqual(rows.find((r) => r.port === port)?.origin, "auto");
  },
);

Then(
  "the ports section should no longer show port {int} as forwarded",
  async function (this: KoluWorld, port: number) {
    await pollFor({
      observe: () => forwardRows(this),
      isDone: (rows) => !rows.some((row) => row.port === port),
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `Expected port ${port} to leave Forwarded Ports within ${elapsedMs}ms; saw ${JSON.stringify(last)}`,
        ),
    });
  },
);

When(
  "I cancel the forward for port {int}",
  async function (this: KoluWorld, port: number) {
    const cancel = this.page
      .locator(`[data-testid="forward-cancel"][data-port="${port}"]`)
      .first();
    await cancel.waitFor({ state: "visible", timeout: FORWARD_TIMEOUT });
    await cancel.click();
  },
);

Then(
  "the forwarded port should refuse connections",
  async function (this: KoluWorld) {
    const url = this.forwardedUrl;
    assert.ok(url, "no forwarded URL was recorded");
    await pollFor({
      observe: async () => {
        try {
          await fetch(url, { signal: AbortSignal.timeout(2_000) });
          return "answered";
        } catch {
          return "refused";
        }
      },
      isDone: (result) => result === "refused",
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `${url} was still answering ${elapsedMs}ms after its forward was cancelled — the listener outlived the row`,
        ),
    });
  },
);
