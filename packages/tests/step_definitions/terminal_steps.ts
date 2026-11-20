import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  readPerTerminal,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor, pollUntil } from "../support/poll.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

async function clearClipboard(world: KoluWorld) {
  await world.page
    .evaluate(() => navigator.clipboard?.writeText?.(""))
    .catch(() => undefined);
}

async function countTerminals(world: KoluWorld) {
  return world.page
    .locator('[data-testid="canvas-tile"][data-terminal-id]')
    .count();
}

Given("the terminal is ready", async function (this: KoluWorld) {
  await this.page.goto("/");
  await clearClipboard(this);
  await this.waitForReady();
});

When("I run {string}", async function (this: KoluWorld, command: string) {
  await this.terminalRunAndWait(command);
  await this.waitForFrame();
});

When("I start {string}", async function (this: KoluWorld, command: string) {
  await this.terminalRun(command);
  await this.waitForFrame();
});

When("I refresh the page", async function (this: KoluWorld) {
  this.terminalCountBeforeRefresh = await countTerminals(this);
  await this.page.reload();
  await this.waitForSettled();
});

Then(
  "the terminal should contain {string}",
  async function (this: KoluWorld, _expected: string) {
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
  await this.waitForFrame();
});

When("I zoom in {int} time(s)", async function (this: KoluWorld, n: number) {
  for (let i = 0; i < n; i++) await this.zoomIn();
});

When("I zoom out {int} time(s)", async function (this: KoluWorld, n: number) {
  for (let i = 0; i < n; i++) await this.zoomOut();
});

Given("I note the canvas dimensions", async function (this: KoluWorld) {
  this.savedCanvas = await this.canvasBox();
});

Given("I note the font size", async function (this: KoluWorld) {
  this.savedFontSize = await this.fontSize();
});

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
    const ratio = pct / 100;
    await pollFor({
      observe: async () => ({
        canvas: await this.canvasBox(),
        container: await this.containerBox(),
      }),
      isDone: ({ canvas, container }) =>
        canvas.width > container.width * ratio &&
        canvas.height > container.height * ratio,
      timeoutMs: POLL_TIMEOUT,
      intervalMs: 100,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `after ${elapsedMs}ms the terminal is ${Math.round(last?.canvas.width ?? -1)}x${Math.round(last?.canvas.height ?? -1)} ` +
            `in a ${Math.round(last?.container.width ?? -1)}x${Math.round(last?.container.height ?? -1)} container — ` +
            `less than ${pct}% of it, so the grid the daemon handed back never filled the box`,
        ),
    });
  },
);

When("I click the terminal canvas", async function (this: KoluWorld) {
  await this.page.locator("body").click({ position: { x: 0, y: 0 } });
  await this.canvas.click();
});

When("I click the terminal tile title bar", async function (this: KoluWorld) {
  await this.page
    .locator(
      `${ACTIVE_CANVAS_TILE_SELECTOR} [data-testid="canvas-tile-titlebar"]`,
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

Given("I intercept oRPC sendInput calls", async function (this: KoluWorld) {
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
    for (const msg of messages) {
      if (!msg.includes("sendInput")) continue;
      for (const key of [k1, k2, k3]) {
        assert.ok(
          !msg.includes(`"data":"${key}"`),
          `Zoom keystroke "${key}" leaked via sendInput: ${msg}`,
        );
      }
    }
  },
);

Then(
  "the shell should receive the {string} control byte",
  async function (this: KoluWorld, hex: string) {
    const code = Number.parseInt(hex, 16);
    assert.ok(
      Number.isInteger(code) && code > 0 && code < 32,
      `not a control byte: ${hex}`,
    );
    const spellings = [
      String.fromCharCode(code),
      `\\u${code.toString(16).padStart(4, "0")}`,
      `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`,
    ];
    const messages: string[] = await this.page.evaluate(
      () => window.__wsSent ?? [],
    );
    const sendInputs = messages.filter((m) => m.includes("sendInput"));
    assert.ok(
      sendInputs.some((m) => spellings.some((s) => m.includes(s))),
      `no sendInput frame carried the ${hex} control byte — kolu claimed the ` +
        `chord before xterm could forward it. ${sendInputs.length} sendInput ` +
        `frame(s) seen: ${JSON.stringify(sendInputs.slice(0, 5))}`,
    );
  },
);

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

async function readAllFontSizes(
  world: KoluWorld,
): Promise<Record<string, number>> {
  return readPerTerminal(world.page, "fontSize");
}

async function readFocusedTerminalId(world: KoluWorld): Promise<string | null> {
  return world.page.evaluate((sel) => {
    const focused = document.querySelectorAll(sel);
    if (focused.length !== 1) return null;
    return focused[0]?.getAttribute("data-terminal-id") ?? null;
  }, ACTIVE_TERMINAL);
}

When("I note the font size of each terminal", async function (this: KoluWorld) {
  const sizes = await readAllFontSizes(this);
  assert.ok(
    Object.keys(sizes).length >= 2,
    `Expected at least 2 terminals, found ${Object.keys(sizes).length}`,
  );
  const focusedId = await readFocusedTerminalId(this);
  assert.ok(focusedId, "Expected exactly one focused terminal before zoom");
  this.savedTerminalZoom = { sizes, focusedId };
});

Then(
  "only the focused terminal's font size should have changed",
  async function (this: KoluWorld) {
    const snapshot = this.savedTerminalZoom;
    assert.ok(snapshot, "No saved pre-zoom terminal snapshot");
    const { sizes: before, focusedId } = snapshot;
    const after = await readAllFontSizes(this);
    const changed = Object.keys(before).filter(
      (id) => after[id] !== before[id],
    );
    assert.deepStrictEqual(
      changed,
      [focusedId],
      `Expected only the focused terminal (${focusedId}) to change font size. ` +
        `changed=${JSON.stringify(changed)} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );
  },
);
