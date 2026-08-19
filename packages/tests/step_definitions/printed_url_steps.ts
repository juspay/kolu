/**
 * Steps for PRT4 — printed loopback URLs join the scanner.
 *
 * Coordinate-click the xterm web link (same public-API geometry as file-ref
 * clicks). The footnote permits driving the activate path directly if that
 * proves flaky — take that only with a report.
 */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Two 5 s scan ticks plus room for the surface round trip. */
const PORT_SCAN_TIMEOUT = 25_000;
const FORWARD_TIMEOUT = 15_000;
const LISTENER_START_TIMEOUT = 20_000;

const LISTENING = "kolu-e2e-listening";
const LISTENING_EXPR = '"kolu-e2e"+"-listening"';

/** Path-aware listener: body is `ok:<url>` so the door can prove the path rode
 *  through. Marker is built at runtime so the shell echo cannot satisfy it. */
function pathAwareListenerCommand(port: number, host: string): string {
  return `'${process.execPath}' -e 'require("http").createServer((q,r)=>r.end("ok:"+q.url)).listen(${port},"${host}",()=>console.log(${LISTENING_EXPR}))'`;
}

async function waitForListening(world: KoluWorld, port: number): Promise<void> {
  try {
    await waitForBufferContains(world.page, LISTENING, {
      selector: ACTIVE_TERMINAL,
      timeout: LISTENER_START_TIMEOUT,
    });
  } catch {
    const shown = await world.page.evaluate(
      (sel) => window.__readXtermBuffer?.(sel, 0) ?? "",
      ACTIVE_TERMINAL,
    );
    throw new Error(
      `The listener on port ${port} never bound within ${LISTENER_START_TIMEOUT}ms. ` +
        `The terminal last showed:\n${shown.trimEnd().split("\n").slice(-12).join("\n")}`,
    );
  }
}

type ClickPoint = { x: number; y: number } | null;

async function findWebLinkPoint(
  world: KoluWorld,
  urlText: string,
): Promise<ClickPoint> {
  return world.page.evaluate(
    ({ sel, target }) => {
      type BufferLine = { translateToString(trim?: boolean): string };
      type XtermForClick = {
        cols: number;
        rows: number;
        buffer: {
          active: {
            viewportY: number;
            getLine(index: number): BufferLine | undefined;
          };
        };
      };
      const container = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: XtermForClick })
        | null;
      const term = container?.__xterm;
      const screen = container?.querySelector("[data-terminal-screen]");
      if (!container || !term || !screen) return null;
      const { active } = term.buffer;
      const top = active.viewportY;
      for (let row = top; row < top + term.rows; row++) {
        const line = active.getLine(row)?.translateToString(true) ?? "";
        const col = line.indexOf(target);
        if (col < 0) continue;
        const rect = screen.getBoundingClientRect();
        const cellW = rect.width / term.cols;
        const cellH = rect.height / term.rows;
        // Aim near the middle of the URL span so the link hit-test lands.
        const mid = col + Math.min(target.length, 12) / 2;
        return {
          x: rect.left + mid * cellW,
          y: rect.top + (row - top + 0.5) * cellH,
        };
      }
      return null;
    },
    { sel: ACTIVE_TERMINAL, target: urlText },
  );
}

async function resolveWebLinkPoint(
  world: KoluWorld,
  urlText: string,
): Promise<{ x: number; y: number }> {
  await waitForBufferContains(world.page, urlText);
  const point = await pollFor({
    observe: () => findWebLinkPoint(world, urlText),
    isDone: (p) => p !== null,
    onTimeout: (last, ms) =>
      new Error(
        `terminal web link "${urlText}" had no clickable point after ${ms}ms (last=${JSON.stringify(last)})`,
      ),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: 50,
  });
  if (point === null) throw new Error("unreachable: missing web-link point");
  return point;
}

When(
  "I start a path-aware listener on port {int} bound to loopback only",
  async function (this: KoluWorld, port: number) {
    await this.terminalRun(pathAwareListenerCommand(port, "127.0.0.1"));
    await waitForListening(this, port);
  },
);

When("I print the URL {string}", async function (this: KoluWorld, url: string) {
  // Echo only — the shell prints the line, WebLinksAddon linkifies it.
  // Use printf so the URL is not re-expanded by the shell.
  await this.terminalRun(`printf '%s\\n' '${url}'`);
  await waitForBufferContains(this.page, url);
});

When(
  "I click the terminal web link {string}",
  async function (this: KoluWorld, urlText: string) {
    const point = await resolveWebLinkPoint(this, urlText);
    await this.page.mouse.move(point.x, point.y);
    await this.waitForFrame();
    await this.page.mouse.click(point.x, point.y);
    await this.waitForFrame();
  },
);

When(
  "I cmd-click the terminal web link {string}",
  async function (this: KoluWorld, urlText: string) {
    const point = await resolveWebLinkPoint(this, urlText);
    await this.page.mouse.move(point.x, point.y);
    await this.waitForFrame();
    const popup = this.context.waitForEvent("page", {
      timeout: FORWARD_TIMEOUT,
    });
    await this.page.keyboard.down(
      process.platform === "darwin" ? "Meta" : "Control",
    );
    await this.page.mouse.click(point.x, point.y);
    await this.page.keyboard.up(
      process.platform === "darwin" ? "Meta" : "Control",
    );
    this.externalPopup = await popup;
    await this.waitForFrame();
  },
);

Then(
  "the printed-url card should be open with join state {string}",
  async function (this: KoluWorld, state: string) {
    await pollFor({
      observe: async () => {
        return this.page.evaluate(() => {
          const card = document.querySelector(
            '[data-testid="printed-url-card"]',
          );
          if (card === null) return null;
          return card.getAttribute("data-join");
        });
      },
      isDone: (join) => join === state,
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `Expected printed-url card join="${state}" within ${ms}ms; last=${JSON.stringify(last)}`,
        ),
    });
  },
);

Then(
  "the printed-url card should upgrade to join state {string}",
  async function (this: KoluWorld, state: string) {
    // Same assertion as open-with-state, sized for a scan tick after bind.
    await pollFor({
      observe: async () => {
        return this.page.evaluate(() => {
          const card = document.querySelector(
            '[data-testid="printed-url-card"]',
          );
          if (card === null) return null;
          return card.getAttribute("data-join");
        });
      },
      isDone: (join) => join === state,
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `Expected live upgrade to join="${state}" within ${ms}ms; last=${JSON.stringify(last)}`,
        ),
    });
  },
);

Then(
  "the printed-url card should not be open",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const open = await this.page.evaluate(
      () => document.querySelector('[data-testid="printed-url-card"]') !== null,
    );
    assert.strictEqual(open, false, "printed-url card was open");
  },
);

When(
  "I click forward-and-open on the printed-url card",
  async function (this: KoluWorld) {
    const button = this.page.locator(
      '[data-testid="printed-url-forward-open"]',
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
  "the forwarded tab should load the listener path {string}",
  async function (this: KoluWorld, path: string) {
    const popup = this.externalPopup;
    assert.ok(popup, "no forwarded tab was captured");
    const expected = `ok:${path}`;
    await pollFor({
      observe: async () => {
        try {
          return await popup.evaluate(() => document.body?.textContent ?? "");
        } catch {
          return "";
        }
      },
      isDone: (body) => body.includes(expected),
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `The forwarded tab never showed ${JSON.stringify(expected)} within ${elapsedMs}ms — ` +
            `it is at ${popup.url()} showing ${JSON.stringify(last)}`,
        ),
    });
    const url = new URL(popup.url());
    assert.strictEqual(
      url.pathname,
      path,
      `door URL path was ${url.pathname}, expected ${path}`,
    );
    this.forwardedUrl = popup.url();
  },
);

Then(
  "a raw popup should have opened for {string}",
  async function (this: KoluWorld, expected: string) {
    const popup = this.externalPopup;
    assert.ok(popup, "no raw popup was captured");
    // URL may normalize trailing slash; compare origin+path loosely.
    await pollFor({
      observe: () => popup.url(),
      isDone: (u) => {
        if (u === expected || u === expected.replace(/\/$/, "")) return true;
        try {
          const a = new URL(u);
          const b = new URL(expected);
          return a.host === b.host && a.pathname === b.pathname;
        } catch {
          return false;
        }
      },
      timeoutMs: FORWARD_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `Raw popup URL was ${JSON.stringify(last)}, expected ${expected} (${ms}ms)`,
        ),
    });
  },
);
