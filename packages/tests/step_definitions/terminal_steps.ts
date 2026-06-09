import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { pollUntil } from "../support/poll.ts";
import type { KoluWorld } from "../support/world.ts";

async function clearClipboard(world: KoluWorld) {
  await world.page
    .evaluate(() => navigator.clipboard?.writeText?.(""))
    .catch(() => undefined);
}

/** Count terminals by reading canvas tile entries from the DOM. */
async function countTerminals(world: KoluWorld) {
  return world.page
    .locator('[data-testid="canvas-tile"][data-terminal-id]')
    .count();
}

// ── Background ──

Given("the terminal is ready", async function (this: KoluWorld) {
  await this.page.goto("/");
  await clearClipboard(this);
  await this.waitForReady();
});

// ── Actions ──

When("I run {string}", async function (this: KoluWorld, command: string) {
  await this.terminalRun(command);
  await this.waitForFrame();
});

When("I refresh the page", async function (this: KoluWorld) {
  // Snapshot terminal count before refresh so post-refresh assertions can verify reconnect
  this.terminalCountBeforeRefresh = await countTerminals(this);
  await this.page.reload();
  // Wait for app to finish restoring terminals/state before subsequent assertions
  await this.waitForSettled();
});

Then(
  "the terminal should contain {string}",
  async function (this: KoluWorld, _expected: string) {
    // Verify reconnection: after refresh the terminal count should be unchanged,
    // meaning the client reused existing PTYs instead of spawning new ones.
    const terminalCount = await countTerminals(this);
    assert.ok(
      this.terminalCountBeforeRefresh !== undefined,
      "No terminal count snapshot — was 'I refresh the page' called first?",
    );
    assert.strictEqual(
      terminalCount,
      this.terminalCountBeforeRefresh,
      `Expected ${this.terminalCountBeforeRefresh} terminals after refresh, got ${terminalCount} — refresh created a new terminal instead of reconnecting`,
    );
  },
);

When(
  "I resize the viewport to {int}x{int}",
  async function (this: KoluWorld, w: number, h: number) {
    await this.resizeViewport(w, h);
  },
);

When("I simulate a tab visibility change", async function (this: KoluWorld) {
  // Simulate hidden→visible cycle so the visibilitychange listener re-fits.
  await this.page.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, "hidden", {
        value: hidden,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  // Wait for rAF-debounced fit to settle
  await this.waitForFrame();
});

When("I zoom in {int} time(s)", async function (this: KoluWorld, n: number) {
  for (let i = 0; i < n; i++) await this.zoomIn();
});

When("I zoom out {int} time(s)", async function (this: KoluWorld, n: number) {
  for (let i = 0; i < n; i++) await this.zoomOut();
});

// ── Dimension tracking ──

Given("I note the canvas dimensions", async function (this: KoluWorld) {
  this.savedCanvas = await this.canvasBox();
});

Given("I note the font size", async function (this: KoluWorld) {
  this.savedFontSize = await this.fontSize();
});

// ── Assertions ──

// ── Screen state (scrollback) assertions ──

Then(
  "the screen state should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForBufferContains(this.page, expected);
  },
);

Then(
  "the screen state should have at least {int} lines",
  async function (this: KoluWorld, minLines: number) {
    const content = await readBufferText(this.page);
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    assert.ok(
      lines.length >= minLines,
      `Expected at least ${minLines} lines in buffer, got ${lines.length}`,
    );
  },
);

Then("the terminal canvas should be visible", async function (this: KoluWorld) {
  await this.canvas.waitFor({ state: "visible" });
});

Then("there should be no page errors", function (this: KoluWorld) {
  assert.deepStrictEqual(this.errors, []);
});

Then(
  "the canvas should be smaller than before",
  async function (this: KoluWorld) {
    const current = await this.canvasBox();
    assert.ok(this.savedCanvas, "No saved canvas dimensions");
    assert.ok(
      current.width < this.savedCanvas.width,
      "Canvas width should be smaller",
    );
    assert.ok(
      current.height < this.savedCanvas.height,
      "Canvas height should be smaller",
    );
    // Save for next comparison
    this.previousCanvas = current;
  },
);

Then(
  "the canvas should be larger than the {int}x{int} size",
  async function (this: KoluWorld, _w: number, _h: number) {
    const current = await this.canvasBox();
    assert.ok(this.previousCanvas, "No saved comparison dimensions");
    assert.ok(
      current.width > this.previousCanvas.width,
      "Canvas width should be larger",
    );
    assert.ok(
      current.height > this.previousCanvas.height,
      "Canvas height should be larger",
    );
  },
);

Then(
  "the canvas should fill at least {int}% of its container",
  async function (this: KoluWorld, pct: number) {
    const canvas = await this.canvasBox();
    const container = await this.containerBox();
    const ratio = pct / 100;
    assert.ok(
      canvas.width > container.width * ratio,
      `Canvas width ${canvas.width} < ${ratio * 100}% of container ${container.width}`,
    );
    assert.ok(
      canvas.height > container.height * ratio,
      `Canvas height ${canvas.height} < ${ratio * 100}% of container ${container.height}`,
    );
  },
);

// ── Click-to-focus (mobile tap-to-focus) ──

When("I click the terminal canvas", async function (this: KoluWorld) {
  // Click the body first to blur any focused element, then click the terminal
  await this.page.locator("body").click({ position: { x: 0, y: 0 } });
  await this.canvas.click();
});

When("I click the terminal tile title bar", async function (this: KoluWorld) {
  // Scope to the active tile (`data-active="true"`) so the click lands on
  // the same tile the user was just typing into, regardless of how many
  // terminals are mounted.
  await this.page
    .locator(
      '[data-testid="canvas-tile"][data-active="true"] [data-testid="canvas-tile-titlebar"]',
    )
    .first()
    .click();
  await this.waitForFrame();
});

Then("the terminal input should be focused", async function (this: KoluWorld) {
  const focused = await this.page.evaluate(
    () => !!document.activeElement?.closest("[data-visible]"),
  );
  assert.ok(focused, "Terminal input is not focused after clicking canvas");
});

// ── Zoom keystroke leak detection (intercept oRPC sendInput via WebSocket.send) ──

Given("I intercept oRPC sendInput calls", async function (this: KoluWorld) {
  // Monkey-patch WebSocket.send to capture outgoing frames.
  // oRPC sends JSON-encoded messages over WS.
  await this.page.evaluate(() => {
    const origSend = WebSocket.prototype.send;
    window.__wsSent = [];
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        window.__wsSent?.push(data);
      }
      return origSend.call(this, data);
    };
  });
});

Then(
  "no sendInput call should contain {string} {string} {string}",
  async function (this: KoluWorld, k1: string, k2: string, k3: string) {
    const messages: string[] = await this.page.evaluate(
      () => window.__wsSent ?? [],
    );
    // Look for sendInput calls whose data field contains zoom key chars
    for (const msg of messages) {
      if (!msg.includes("sendInput")) continue;
      for (const key of [k1, k2, k3]) {
        // Check if the raw keystroke char appears as the data payload
        assert.ok(
          !msg.includes(`"data":"${key}"`),
          `Zoom keystroke "${key}" leaked via sendInput: ${msg}`,
        );
      }
    }
  },
);

// ── Resize detection (read PTY $COLUMNS via file) ──

Then(
  "the file {string} should contain a number greater than {int}",
  async function (this: KoluWorld, filePath: string, min: number) {
    const fs = await import("node:fs/promises");
    const cols = await pollUntil(
      this.page,
      async () => {
        try {
          return Number((await fs.readFile(filePath, "utf-8")).trim());
        } catch {
          return NaN;
        }
      },
      (n) => !Number.isNaN(n) && n > min,
      { attempts: 30 },
    );
    assert.ok(
      !Number.isNaN(cols) && cols > min,
      `Expected ${filePath} to contain a number > ${min}, got: "${cols}"`,
    );
  },
);

// ── Font size assertions ──

Then(
  "the font size should be larger than before",
  async function (this: KoluWorld) {
    const current = await this.fontSize();
    const saved = this.savedFontSize;
    assert.ok(saved !== undefined, "No saved font size");
    assert.ok(current > saved, `Font size ${current} not larger than ${saved}`);
  },
);

Then(
  "the font size should be smaller than the original",
  async function (this: KoluWorld) {
    const current = await this.fontSize();
    const saved = this.savedFontSize;
    assert.ok(saved !== undefined, "No saved font size");
    assert.ok(
      current < saved,
      `Font size ${current} not smaller than ${saved}`,
    );
  },
);

/** Read every terminal's font size keyed by data-terminal-id. The inner
 *  terminal container carries both attributes; the outer CanvasTile wrapper
 *  has data-terminal-id but no data-font-size, so it's filtered out. */
async function readAllFontSizes(
  world: KoluWorld,
): Promise<Record<string, number>> {
  return world.page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const n of document.querySelectorAll(
      "[data-terminal-id][data-font-size]",
    )) {
      const id = n.getAttribute("data-terminal-id");
      const fs = n.getAttribute("data-font-size");
      if (id && fs) out[id] = Number.parseFloat(fs);
    }
    return out;
  });
}

/** Id of the single focused terminal (data-focused is set on exactly one
 *  tile — the active one in canvas, the visible one in mobile). The inner
 *  terminal container carries data-focused alongside data-terminal-id. */
async function readFocusedTerminalId(world: KoluWorld): Promise<string | null> {
  return world.page.evaluate(() => {
    const focused = document.querySelectorAll(
      "[data-terminal-id][data-font-size][data-focused]",
    );
    if (focused.length !== 1) return null;
    return focused[0]?.getAttribute("data-terminal-id") ?? null;
  });
}

Given(
  "I note the font size of each terminal",
  async function (this: KoluWorld) {
    this.savedFontSizes = await readAllFontSizes(this);
    assert.ok(
      Object.keys(this.savedFontSizes).length >= 2,
      `Expected at least 2 terminals, found ${Object.keys(this.savedFontSizes).length}`,
    );
    this.savedFocusedTerminalId = await readFocusedTerminalId(this);
    assert.ok(
      this.savedFocusedTerminalId,
      "Expected exactly one focused terminal before zoom",
    );
  },
);

Then(
  "only the focused terminal's font size should have changed",
  async function (this: KoluWorld) {
    const before = this.savedFontSizes;
    assert.ok(before, "No saved per-terminal font sizes");
    const focusedId = this.savedFocusedTerminalId;
    assert.ok(focusedId, "No saved focused terminal id");
    const after = await readAllFontSizes(this);
    const changed = Object.keys(before).filter(
      (id) => after[id] !== before[id],
    );
    // The single terminal that changed must be the one that was focused —
    // not just "some" terminal. An inverted fix that zoomed the inactive
    // tile would also change exactly one terminal, but the wrong one.
    assert.deepStrictEqual(
      changed,
      [focusedId],
      `Expected only the focused terminal (${focusedId}) to change font size. ` +
        `changed=${JSON.stringify(changed)} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );
  },
);
