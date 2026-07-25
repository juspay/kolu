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
  "I start a listener on port {int} in the split terminal",
  async function (this: KoluWorld, port: number) {
    // A split is its own PTY with its own process subtree, so its ports are
    // attributed to IT, not to the tile's main pane. Typing here rather than
    // through `terminalRun` (which deliberately excludes `[data-sub-terminal]`)
    // is the whole point of the scenario.
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
}

async function portsView(world: KoluWorld): Promise<PortsView> {
  return world.page.evaluate(() => {
    const section = document.querySelector('[data-testid="inspector-ports"]');
    if (section === null) return { present: false, rows: [] };
    return {
      present: true,
      rows: [...section.querySelectorAll("[data-port]")].map((el) => ({
        port: Number(el.getAttribute("data-port")),
        openable: el.getAttribute("data-testid") === "inspector-port-open",
      })),
    };
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
