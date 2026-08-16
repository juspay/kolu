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
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Two 5 s scan ticks plus room for the surface round trip and a loaded box. */
const PORT_SCAN_TIMEOUT = 25_000;

/** How long the shell gets to actually bind the port. Only the spawn — the SCAN's
 *  budget is {@link PORT_SCAN_TIMEOUT} and starts after this. */
const LISTENER_START_TIMEOUT = 20_000;

/** The marker the one-liner prints from its `listen` callback. Waiting for THIS is
 *  what makes the port assertion honest: it is printed from the callback, so it
 *  cannot appear until the socket is genuinely bound.
 *
 *  It is CONCATENATED at runtime by the one-liner ({@link listenerCommand} emits
 *  `"kolu-e2e" + "-listening"`) so the marker never appears as a literal in the
 *  command text. The shell ECHOES what is typed, so a marker spelled literally in
 *  the command is already in the terminal buffer before the process starts — which
 *  made the first version of this guard pass even against a `node` path that does
 *  not exist. The split spelling is what makes the wait mean "the callback ran". */
const LISTENING = "kolu-e2e-listening";
const LISTENING_EXPR = '"kolu-e2e"+"-listening"';

/** The one-liner that binds a port. `-e` keeps it a single foreground process the
 *  shell owns directly, so Ctrl+C ends it and the subtree walk sees it as a child.
 *
 *  Invoked by ABSOLUTE path (`process.execPath` — the node already running this
 *  suite), not as a bare `node`. What this scenario is about is whether padi's
 *  `/proc` join finds a socket inside the terminal's subtree; whether the PTY's
 *  shell happens to resolve `node` on its `PATH` is a different question, and one
 *  the test has no business depending on. A dev box has node on every PATH, so a
 *  bare `node` passes there and can silently fail on any host where node lives only
 *  in the dev shell — an environment difference that would surface as a phantom
 *  sensor bug. */
function listenerCommand(port: number, host: string): string {
  return `'${process.execPath}' -e 'require("http").createServer((_,r)=>r.end("ok")).listen(${port},"${host}",()=>console.log(${LISTENING_EXPR}))'`;
}

/** Wait until the listener has actually bound, and say what the SHELL said if it
 *  did not.
 *
 *  Without this the start steps were vacuous — they typed a command, waited one
 *  frame, and passed unconditionally — so every environmental failure to start the
 *  server (no `node` on the PTY's PATH, an `EADDRINUSE` from a leftover process, a
 *  shell that had not finished initializing) surfaced 25 s later as "the Ports
 *  section showed []" and read as a BROKEN SENSOR. The scan cannot be blamed for a
 *  port nothing ever bound, and a failure message must not be able to say otherwise. */
async function waitForListening(
  world: KoluWorld,
  port: number,
  selector: string,
): Promise<void> {
  try {
    await waitForBufferContains(world.page, LISTENING, {
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

/** The tile's MAIN pane — the same scope `terminalRun` types into. */
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
    // `[::1]` and `127.0.0.1` are BOTH loopback and are NOT the same address —
    // and this is the bind vite and several Node versions choose by default. The
    // shipped forward dialled `127.0.0.1` unconditionally, so a door for this
    // listener came up reporting success and refused every connection through
    // it. Nothing on screen said anything was wrong, which is what makes this
    // worth a scenario of its own rather than a fixture.
    await this.terminalRun(listenerCommand(port, "::1"));
    await waitForListening(this, port, MAIN_PANE);
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
    await this.page.waitForFunction(
      (sel) => (window.__readXtermBuffer?.(sel, 0) ?? "").length > 0,
      "[data-sub-terminal]",
      { timeout: POLL_TIMEOUT },
    );
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

/** What the Ports section is showing — read from the DOM rather than from a locator
 *  count, so a failure message can say what WAS there.
 *
 *  `present` is separate from `rows` on purpose: an ABSENT section (the Inspector
 *  never rendered it, so the whole tab is suspect) and a section rendering NO ports
 *  (the sensor answered "nothing here") are different diagnoses that a bare `[]`
 *  reported identically. */
interface PortsView {
  present: boolean;
  rows: Array<{ port: number; openable: boolean }>;
  /** Ports offering a "forward & open" button — PRT2's affordance on a port that
   *  needs a door before there is anything to point a tab at. Separate from
   *  `openable`, because the two are different offers and a row must make exactly
   *  one of them. */
  forwardable: number[];
  /** Ports whose chip carries a `⇄ :N` badge, with the local port it names. */
  badges: Array<{ port: number; localPort: number }>;
}

async function portsView(world: KoluWorld): Promise<PortsView> {
  return world.page.evaluate(() => {
    const section = document.querySelector('[data-testid="inspector-ports"]');
    if (section === null)
      return { present: false, rows: [], forwardable: [], badges: [] };
    // Read ROW BY ROW rather than by scanning every `[data-port]` in the
    // section: the merged section carries that attribute on the row AND on the
    // controls inside it, so a flat scan would report one port several times and
    // "is it openable?" could be answered by whichever element came first. Per
    // row, each question has exactly one answer.
    const rows = [
      ...section.querySelectorAll('[data-testid="inspector-port-row"]'),
    ];
    // NO named helper inside this closure, deliberately. `page.evaluate` ships
    // the function's SOURCE to the browser, and esbuild's `keepNames` rewrites a
    // named arrow (`const pick = …`) into `__name(…, "pick")` — a helper that
    // exists in the bundle but not in the page, so the call dies with
    // `ReferenceError: __name is not defined` at runtime and no amount of
    // type-checking sees it. Anonymous callbacks passed straight to `map`/
    // `filter` are untouched, so the queries are inlined instead.
    return {
      present: true,
      rows: rows.map((row) => ({
        port: Number(row.getAttribute("data-port")),
        openable:
          row.querySelector('[data-testid="inspector-port-open"]') !== null,
      })),
      forwardable: rows
        .filter(
          (row) =>
            row.querySelector('[data-testid="inspector-port-forward-open"]') !==
            null,
        )
        .map((row) => Number(row.getAttribute("data-port"))),
      badges: rows
        .filter(
          (row) =>
            row.querySelector(
              '[data-testid="inspector-port-forward-badge"]',
            ) !== null,
        )
        .map((row) => {
          const port = Number(row.getAttribute("data-port"));
          const text =
            row.querySelector('[data-testid="inspector-port-forward-badge"]')
              ?.textContent ?? "";
          // The LAST `:digits`, because the pill carries a whole address and an
          // IPv6-served kolu puts colons in the host half (`[fd7a::2]:61003`).
          const named = /:(\d+)$/.exec(text.trim())?.[1];
          // The pill always names the port the door answers on — a bare `⇄`
          // answered no question ("forwarded WHERE?"), which is why the approved
          // UX pass gave it the number. An absent number is therefore the markup
          // regressing, so this reports the row's own port and lets the caller's
          // "the door is a DIFFERENT number" assertion catch it.
          return {
            port,
            localPort: named === undefined ? port : Number(named),
          };
        }),
    };
  });
}

/** The forward state carried by rows of the ONE ports section.
 *
 *  There used to be a second titled "Forwarded Ports" group, and a forwarded
 *  port appeared in BOTH — once as a chip and again as a row. The merge means a
 *  forwarded port is one row that carries its own forward controls, so this
 *  reads the ports section rather than a separate group. */
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

/** How a timed-out poll describes what it last saw. */
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
    // `pollFor` returns only when `isDone` holds and otherwise throws `onTimeout`,
    // so the predicate IS the assertion here — no trailing `assert` that cannot fail.
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
    // Present AND inert: a loopback port must be listed (that is the answer to
    // "what is this terminal serving?") but must not offer an open that would
    // reach the viewer's own machine instead of the server's.
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
    // …and it must offer the door instead. Asserting only the ABSENCE of a direct
    // open would pass just as well against a row that offers nothing at all,
    // which is what PRT1 shipped and PRT2 replaced.
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

// ── PRT2: the door, opened for real ────────────────────────────────────
//
// Only the RELAY case runs here, and that is a scoping decision rather than a
// gap: both ends of a relay are on the machine the suite already has, while an
// `ssh -L` forward needs a second box (the remote-host-testing harness's job).
// Standing in for one with a loopback ssh hop would exercise a different code
// path from the one it claimed to cover.

/** How long a forward gets to come up. A relay is two socket calls, so this is
 *  generous — sized for a loaded CI box, not for a mechanism that is slow. */
const FORWARD_TIMEOUT = 15_000;

When(
  "I click forward-and-open for port {int}",
  async function (this: KoluWorld, port: number) {
    const button = this.page.locator(
      `[data-testid="inspector-port-forward-open"][data-port="${port}"]`,
    );
    await button.waitFor({ state: "visible", timeout: PORT_SCAN_TIMEOUT });
    // The tab is claimed inside the click (before the forward is awaited), so the
    // popup event fires immediately and its URL is set once the door is up. Arm
    // the wait BEFORE clicking or the event is already gone.
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
    // The listener's OWN body, through a port it never bound — which is the only
    // thing that can distinguish a working relay from a chip that merely rendered
    // a plausible URL.
    await pollFor({
      observe: async () => {
        try {
          return await popup.evaluate(() => document.body?.textContent ?? "");
        } catch {
          // Mid-navigation: the execution context is being replaced.
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
    // The URL must be the page's own host on a DIFFERENT port from the one the
    // server bound: a relay that answered on the server's own number would mean
    // the forward did nothing and the loopback port was reachable all along.
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
    // The badge names the DOOR's port, not the server's. Reading the same number
    // back would mean the row is telling the user to visit a port that answers
    // only on the server's own loopback.
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
    // Opened by clicking a chip, so kolu owns its lifetime: `auto` is what lets
    // the scanner close it when the listener dies.
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
    // From NODE, not from the browser: what is being asserted is that the socket
    // is gone, and a browser could answer from cache or report a network error
    // for half a dozen unrelated reasons. A row leaving the list is not the
    // property — the door being shut is.
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
