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

// ── WebSocket interception ──

// Monkey-patches WebSocket.send to capture outgoing messages in window.__wsSent.
function wsInterceptScript() {
  const origSend = WebSocket.prototype.send;
  (window as any).__wsSent = [];
  WebSocket.prototype.send = function (data: any) {
    if (typeof data === "string") {
      (window as any).__wsSent.push(data);
    }
    return origSend.call(this, data);
  };
}

Given("I intercept WebSocket messages", async function (this: KoluWorld) {
  await this.page.evaluate(wsInterceptScript);
  await this.page.evaluate(() => {
    (window as any).__wsSent = [];
  });
});

Given(
  "I intercept WebSocket messages from page load",
  async function (this: KoluWorld) {
    await this.page.addInitScript(wsInterceptScript);
  },
);

When(
  "the page reloads and the terminal is ready",
  async function (this: KoluWorld) {
    await this.page.reload();
    await this.waitForReady();
    await this.page.waitForTimeout(1000);
  },
);

Then(
  "no raw keystroke {string} {string} {string} should have been sent via WebSocket",
  async function (this: KoluWorld, k1: string, k2: string, k3: string) {
    const messages: string[] = await this.page.evaluate(
      () => (window as any).__wsSent,
    );
    for (const msg of messages) {
      assert.notStrictEqual(msg, k1, `Raw keystroke "${k1}" was sent`);
      assert.notStrictEqual(msg, k2, `Raw keystroke "${k2}" was sent`);
      assert.notStrictEqual(msg, k3, `Raw keystroke "${k3}" was sent`);
    }
  },
);

Then(
  "a Resize message with cols greater than {int} should have been sent",
  async function (this: KoluWorld, minCols: number) {
    const messages: string[] = await this.page.evaluate(
      () => (window as any).__wsSent,
    );
    const resizeMsg = messages.find((m) => m.includes('"Resize"'));
    assert.ok(resizeMsg, "No Resize message found");
    const parsed = JSON.parse(resizeMsg!);
    assert.ok(
      parsed.cols > minCols,
      `Resize cols ${parsed.cols} not greater than ${minCols}`,
    );
  },
);
