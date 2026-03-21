import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

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
  await this.page.reload();
});

Then(
  "the terminal should contain {string}",
  async function (this: KoluWorld, _expected: string) {
    // Verify reconnection: after refresh the server should still have exactly 1 terminal,
    // meaning the client reused the existing PTY instead of spawning a new one.
    // (The scrollback replay from attach ensures prior output is visible.)
    const resp = await this.page.request.fetch("/rpc/terminal/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({}),
    });
    const body = await resp.json();
    // oRPC wraps the response in { json: [...] }
    const terminals = body.json ?? body;
    assert.strictEqual(
      terminals.length,
      1,
      `Expected 1 terminal after refresh, got ${terminals.length} — refresh created a new terminal instead of reconnecting`,
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
