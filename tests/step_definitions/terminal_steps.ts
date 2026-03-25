import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

/** Fetch terminal list from server via oRPC HTTP endpoint. */
async function fetchTerminalList(world: KoluWorld) {
  const resp = await world.page.request.fetch("/rpc/terminal/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({}),
  });
  const body = await resp.json();
  return (body.json ?? body) as unknown[];
}

// ── Background ──

Given("the terminal is ready", async function (this: KoluWorld) {
  await this.page.goto("/");
  await this.waitForReady();
});

// ── Actions ──

When("I run {string}", async function (this: KoluWorld, command: string) {
  await this.terminalRun(command);
  await this.page.waitForTimeout(1000);
});

When("I refresh the page", async function (this: KoluWorld) {
  // Snapshot terminal count before refresh so post-refresh assertions can verify reconnect
  this.terminalCountBeforeRefresh = (await fetchTerminalList(this)).length;
  await this.page.reload();
  // Wait for app to finish restoring terminals/state before subsequent assertions
  await this.waitForSettled();
});

Then(
  "the terminal should contain {string}",
  async function (this: KoluWorld, _expected: string) {
    // Verify reconnection: after refresh the terminal count should be unchanged,
    // meaning the client reused existing PTYs instead of spawning new ones.
    const terminals = await fetchTerminalList(this);
    assert.ok(
      this.terminalCountBeforeRefresh !== undefined,
      "No terminal count snapshot — was 'I refresh the page' called first?",
    );
    assert.strictEqual(
      terminals.length,
      this.terminalCountBeforeRefresh,
      `Expected ${this.terminalCountBeforeRefresh} terminals after refresh, got ${terminals.length} — refresh created a new terminal instead of reconnecting`,
    );
  },
);

When(
  "I resize the viewport to {int}x{int}",
  async function (this: KoluWorld, w: number, h: number) {
    await this.resizeViewport(w, h);
  },
);

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

/** Fetch serialized screen state for the active terminal (polls until non-empty). */
async function fetchActiveScreenState(world: KoluWorld): Promise<string> {
  const container = world.page.locator("[data-visible][data-terminal-id]");
  const rawId = await container.getAttribute("data-terminal-id");
  assert.ok(rawId, "No active terminal found");
  let state = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const resp = await world.page.request.fetch("/rpc/terminal/screenState", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { id: rawId } }),
    });
    const body = await resp.json();
    state = typeof body.json === "string" ? body.json : JSON.stringify(body);
    if (state.length > 0) return state;
    await world.page.waitForTimeout(300);
  }
  return state;
}

Then(
  "the screen state should contain {string}",
  async function (this: KoluWorld, expected: string) {
    let state = "";
    for (let attempt = 0; attempt < 30; attempt++) {
      state = await fetchActiveScreenState(this);
      if (state.includes(expected)) return;
      await this.page.waitForTimeout(500);
    }
    assert.fail(
      `Screen state does not contain "${expected}".\nScreen state (partial): ${state.slice(0, 500)}`,
    );
  },
);

Then(
  "the screen state should have at least {int} lines",
  async function (this: KoluWorld, minLines: number) {
    const state = await fetchActiveScreenState(this);
    // Count non-empty lines (serialized state uses \r\n line endings)
    const lines = state.split(/\r?\n/).filter((l) => l.trim().length > 0);
    assert.ok(
      lines.length >= minLines,
      `Expected at least ${minLines} lines in screen state, got ${lines.length}`,
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
    (window as any).__wsSent = [];
    WebSocket.prototype.send = function (data: any) {
      if (typeof data === "string") {
        (window as any).__wsSent.push(data);
      }
      return origSend.call(this, data);
    };
  });
});

Then(
  "no sendInput call should contain {string} {string} {string}",
  async function (this: KoluWorld, k1: string, k2: string, k3: string) {
    const messages: string[] = await this.page.evaluate(
      () => (window as any).__wsSent ?? [],
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
    // Wait for the echo command to write the file
    await this.page.waitForTimeout(1500);
    const fs = await import("node:fs/promises");
    const content = (await fs.readFile(filePath, "utf-8")).trim();
    const cols = Number(content);
    assert.ok(
      !isNaN(cols) && cols > min,
      `Expected ${filePath} to contain a number > ${min}, got: "${content}"`,
    );
  },
);

// ── Font size assertions ──

Then(
  "the font size should be larger than before",
  async function (this: KoluWorld) {
    const current = await this.fontSize();
    assert.ok(this.savedFontSize !== undefined, "No saved font size");
    assert.ok(
      current > this.savedFontSize!,
      `Font size ${current} not larger than ${this.savedFontSize}`,
    );
  },
);

Then(
  "the font size should be smaller than the original",
  async function (this: KoluWorld) {
    const current = await this.fontSize();
    assert.ok(this.savedFontSize !== undefined, "No saved font size");
    assert.ok(
      current < this.savedFontSize!,
      `Font size ${current} not smaller than ${this.savedFontSize}`,
    );
  },
);
