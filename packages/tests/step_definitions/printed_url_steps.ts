/**
 * Steps for PRT4 — printed loopback URLs join the scanner.
 *
 * Coordinate-click the xterm web link (same public-API geometry as file-ref
 * clicks). The footnote permits driving the activate path directly if that
 * proves flaky — take that only with a report.
 */

import * as assert from "node:assert";
import { After, Then, When } from "@cucumber/cucumber";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Two 5 s scan ticks plus room for the surface round trip. */
const PORT_SCAN_TIMEOUT = 25_000;
const FORWARD_TIMEOUT = 15_000;
const LISTENER_START_TIMEOUT = 20_000;

const LISTENING = "kolu-e2e-listening";
const LISTENING_EXPR = '"kolu-e2e"+"-listening"';

/** Path-aware listener: body is `ok:<url>` so the door can prove the path rode
 *  through. Marker is built at runtime so the shell echo cannot satisfy it.
 *  `printPid` appends ` pid=<n>` to the marker — for a detached listener, whose
 *  pid is the only handle left to stop it with. */
function pathAwareListenerCommand(
  port: number,
  host: string,
  opts: { printPid?: boolean } = {},
): string {
  const marker = opts.printPid
    ? `${LISTENING_EXPR}+" pid="+process.pid`
    : LISTENING_EXPR;
  return `'${process.execPath}' -e 'require("http").createServer((q,r)=>r.end("ok:"+q.url)).listen(${port},"${host}",()=>console.log(${marker}))'`;
}

async function waitForListening(world: KoluWorld, port: number): Promise<void> {
  try {
    await waitForBufferContains(world.page, LISTENING, {
      selector: ACTIVE_TERMINAL,
      timeout: LISTENER_START_TIMEOUT,
    });
  } catch {
    const shown = await readBufferText(world.page);
    throw new Error(
      `The listener on port ${port} never bound within ${LISTENER_START_TIMEOUT}ms. ` +
        `The terminal last showed:\n${shown.trimEnd().split("\n").slice(-12).join("\n")}`,
    );
  }
}

/** Pids of detached listeners this worker started. They left the terminal's
 *  process tree on purpose, so closing the terminal does not take them with it:
 *  each scenario that starts one kills it here, or a retry of the same scenario
 *  would meet its own leftover as an `EADDRINUSE`. */
const detachedPids: number[] = [];

After(() => {
  for (const pid of detachedPids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (err) {
      // Already gone is the one expected outcome; anything else is loud.
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
});

/** How long an auto forward must outlive its first reap pass to prove the reaper
 *  saw its listener: two reap intervals (5 s each) plus a scan's slack. */
const REAP_SURVIVAL_MS = 12_000;

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
      const screen = container?.querySelector(".xterm-screen");
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

When(
  "I start a detached path-aware listener on port {int} bound to loopback only",
  async function (this: KoluWorld, port: number) {
    // `( … & )`: the subshell backgrounds the server and exits at once, so the
    // server's parent is gone before it binds and it reparents out of the
    // terminal's process tree — the shape of `odu web-daemon` or anything under
    // `setsid`, without depending on `setsid` being on the PTY's PATH (it is not
    // on darwin). Its stdout is still the PTY, so it can print its own marker.
    const listen = pathAwareListenerCommand(port, "127.0.0.1", {
      printPid: true,
    });
    await this.terminalRun(`( ${listen} & )`);
    await waitForListening(this, port);
    const shown = await readBufferText(this.page);
    const pid = Number(new RegExp(`${LISTENING} pid=(\\d+)`).exec(shown)?.[1]);
    assert.ok(
      Number.isInteger(pid) && pid > 0,
      `the detached listener on port ${port} printed no pid; the terminal showed:\n${shown.trimEnd().split("\n").slice(-6).join("\n")}`,
    );
    detachedPids.push(pid);
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

Then(
  "the printed-url card should mark the server detached",
  async function (this: KoluWorld) {
    // Detached means no terminal's process subtree holds the listener — the card
    // says so rather than naming a terminal, and shows the owner's command line.
    const owner = this.page.locator('[data-testid="printed-url-owner"]');
    await owner.waitFor({ state: "visible", timeout: PORT_SCAN_TIMEOUT });
    await this.page
      .locator('[data-testid="printed-url-detached"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = (await owner.textContent()) ?? "";
    assert.ok(
      text.includes("createServer"),
      `the card's owner line should carry the server's command line; it read ${JSON.stringify(text)}`,
    );
  },
);

Then(
  "the inspector should show port {int} as a detached server of this terminal",
  async function (this: KoluWorld, port: number) {
    // In the FROM-THIS-TERMINAL group, though no subtree of this terminal holds
    // it: the terminal printed its URL and the host's scan holds the listener.
    const row = await pollFor({
      observe: () =>
        this.page.evaluate((p) => {
          const el = document.querySelector(
            `[data-testid="inspector-ports"] [data-testid="inspector-port-row"][data-port="${p}"]`,
          );
          if (el === null) return null;
          return {
            group: el.getAttribute("data-group"),
            detached:
              el.querySelector('[data-testid="inspector-port-detached"]') !==
              null,
          };
        }, port),
      isDone: (r) => r?.detached === true,
      timeoutMs: PORT_SCAN_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `port ${port} was not shown as detached within ${elapsedMs}ms; the row was ${JSON.stringify(last)}`,
        ),
    });
    assert.strictEqual(row?.group, "here");
  },
);

Then(
  "the forward for port {int} should survive the reaper",
  async function (this: KoluWorld, port: number) {
    // The reaper closes an `auto` door once the host's scan no longer holds its
    // listener. When its evidence was only the terminals' own ports, a door onto
    // a detached server died within one reap interval. Held continuously across
    // two intervals, the door proves the reaper sees the host.
    const began = Date.now();
    while (Date.now() - began < REAP_SURVIVAL_MS) {
      const forwarded = await this.page.evaluate(
        (p) =>
          document.querySelector(
            `[data-testid="inspector-ports"] [data-port="${p}"][data-forwarded="yes"]`,
          ) !== null,
        port,
      );
      assert.ok(
        forwarded,
        `the forward for port ${port} was closed ${Date.now() - began}ms into the reap window`,
      );
      await this.page.waitForTimeout(500);
    }
  },
);
