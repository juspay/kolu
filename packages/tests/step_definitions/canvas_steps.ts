import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  APP_KEY,
  CANVAS_TILE_SELECTOR,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const MINIMAP_SELECTOR = '[data-testid="canvas-minimap"]';
const MINIMAP_MAP_SELECTOR = '[data-testid="minimap-map"]';
const MINIMAP_VIEWPORT_RECT_SELECTOR = '[data-testid="minimap-viewport-rect"]';
const MINIMAP_ZOOMBAR_SELECTOR = '[data-testid="minimap-zoombar"]';
const TILE_SELECTOR = `${CANVAS_SELECTOR} ${CANVAS_TILE_SELECTOR}`;

async function waitForCanvas(world: KoluWorld) {
  await world.page
    .locator(CANVAS_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function waitForXterm(world: KoluWorld) {
  await world.page
    .locator("[data-visible] .xterm-screen")
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

Then(
  "the canvas grid background should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) !== null,
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas grid background should not be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) === null,
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "there should be {int} canvas tile(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }: { sel: string; count: number }) => {
        return document.querySelectorAll(sel).length === count;
      },
      { sel: TILE_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas tile should have a title bar",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const bg = document.querySelector(sel);
        if (!bg) return false;
        return bg.querySelector('[data-testid="terminal-meta-name"]') !== null;
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the close button on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const closeButtons = this.page.locator(
      `${CANVAS_SELECTOR} button[title="Close terminal"]`,
    );
    const btn = closeButtons.nth(index - 1);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

Then(
  "the screenshot button should be visible on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const buttons = this.page.locator(
      `${CANVAS_SELECTOR} [data-testid="screenshot-button"]`,
    );
    await buttons
      .nth(index - 1)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the screenshot button on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const buttons = this.page.locator(
      `${CANVAS_SELECTOR} [data-testid="screenshot-button"]`,
    );
    const btn = buttons.nth(index - 1);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

Then(
  "the canvas tiles should be visible in the viewport",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const container = document.querySelector(sel);
        if (!container) return false;
        const tile = container.querySelector('[data-testid="canvas-tile"]');
        if (!tile) return false;
        const cRect = container.getBoundingClientRect();
        const tRect = tile.getBoundingClientRect();
        return (
          tRect.right > cRect.left &&
          tRect.bottom > cRect.top &&
          tRect.left < cRect.right &&
          tRect.top < cRect.bottom
        );
      },
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I zoom the canvas in", async function (this: KoluWorld) {
  const before = await this.page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return parseFloat(el?.getAttribute("data-zoom") ?? "1");
  }, CANVAS_SELECTOR);
  this.zoomBefore = before;
  const container = this.page.locator(CANVAS_SELECTOR);
  await container.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await this.page.evaluate(
    ({ sel }: { sel: string }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -300,
          ctrlKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }),
      );
    },
    { sel: CANVAS_SELECTOR },
  );
  await this.waitForFrame();
});

Then(
  "the canvas zoom level should have changed",
  async function (this: KoluWorld) {
    const before = this.zoomBefore;
    await this.page.waitForFunction(
      ({ sel, prev }: { sel: string; prev: number }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const zoom = parseFloat(el.getAttribute("data-zoom") ?? "1");
        return Math.abs(zoom - prev) > 0.01;
      },
      { sel: CANVAS_SELECTOR, prev: before ?? 1 },
      { timeout: POLL_TIMEOUT },
    );
  },
);

async function waitForTileCenteredInViewport(
  world: KoluWorld,
  pick: "newest" | "active",
) {
  await world.page.waitForFunction(
    ({
      sel,
      activeTileSel,
      pick,
    }: {
      sel: string;
      activeTileSel: string;
      pick: "newest" | "active";
    }) => {
      const container = document.querySelector(sel);
      if (!container) return false;
      let tile: HTMLElement | null;
      if (pick === "newest") {
        const tiles = container.querySelectorAll('[data-testid="canvas-tile"]');
        if (tiles.length < 2) return false;
        tile = tiles[tiles.length - 1] as HTMLElement;
      } else {
        tile = container.querySelector(activeTileSel);
      }
      if (!tile) return false;
      const cRect = container.getBoundingClientRect();
      const tRect = tile.getBoundingClientRect();
      const tileCx = tRect.left + tRect.width / 2 - cRect.left;
      const tileCy = tRect.top + tRect.height / 2 - cRect.top;
      const viewCx = cRect.width / 2;
      const viewCy = cRect.height / 2;
      const tolerance = 40;
      return (
        Math.abs(tileCx - viewCx) < tolerance &&
        Math.abs(tileCy - viewCy) < tolerance
      );
    },
    { sel: CANVAS_SELECTOR, activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR, pick },
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the newest canvas tile should be centered in the viewport",
  async function (this: KoluWorld) {
    await waitForTileCenteredInViewport(this, "newest");
  },
);

When(
  "I create a terminal with keyboard shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.down(APP_KEY);
    await this.page.keyboard.press("t");
    await this.page.keyboard.up(APP_KEY);
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} should be offset from canvas tile {int}",
  async function (this: KoluWorld, a: number, b: number) {
    await this.page.waitForFunction(
      ({ sel, i, j }: { sel: string; i: number; j: number }) => {
        const tiles = document.querySelectorAll(sel);
        const tileA = tiles.item(i) as HTMLElement | null;
        const tileB = tiles.item(j) as HTMLElement | null;
        if (!tileA || !tileB) return false;
        const rA = tileA.getBoundingClientRect();
        const rB = tileB.getBoundingClientRect();
        return Math.abs(rA.left - rB.left) > 1 && Math.abs(rA.top - rB.top) > 1;
      },
      { sel: TILE_SELECTOR, i: a - 1, j: b - 1 },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active canvas tile should be centered in the viewport",
  async function (this: KoluWorld) {
    await waitForTileCenteredInViewport(this, "active");
  },
);

When("I click the minimap arrange button", async function (this: KoluWorld) {
  const button = this.page.locator('[data-testid="minimap-arrange"]');
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

const WINDOW_TRIGGER_SELECTOR = '[data-testid="minimap-window-trigger"]';

Then(
  "the minimap window trigger should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(WINDOW_TRIGGER_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  /^the minimap window should be "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el?.getAttribute("data-window") === want;
      },
      { sel: WINDOW_TRIGGER_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the minimap window trigger", async function (this: KoluWorld) {
  const button = this.page.locator(WINDOW_TRIGGER_SELECTOR);
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

When(
  /^I pick the minimap window option "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, value: string) {
    const opt = this.page.locator(
      `[data-testid="minimap-window-option-${value}"]`,
    );
    await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await opt.click();
    await this.waitForFrame();
  },
);

Then(
  /^minimap tile (\d+) should be in the "(awaiting|working|none)" bucket$/,
  async function (this: KoluWorld, index: number, bucket: string) {
    const i = Number(index) - 1;
    await this.page.waitForFunction(
      ({ i, want }: { i: number; want: string }) => {
        const rects = document.querySelectorAll(
          '[data-testid="minimap-tile-rect"]',
        );
        const rect = rects[i] as HTMLElement | undefined;
        if (!rect) return false;
        return rect.getAttribute("data-bucket") === want;
      },
      { i, want: bucket },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("no two canvas tiles should overlap", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => {
      const tiles = Array.from(document.querySelectorAll(sel)).map((t) =>
        (t as HTMLElement).getBoundingClientRect(),
      );
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i];
          const b = tiles[j];
          if (!a || !b) continue;
          const overlapX = a.left < b.right - 2 && a.right - 2 > b.left;
          const overlapY = a.top < b.bottom - 2 && a.bottom - 2 > b.top;
          if (overlapX && overlapY) return false;
        }
      }
      return true;
    },
    TILE_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When("I save the active canvas tile id", async function (this: KoluWorld) {
  const id = await this.page.evaluate((activeTileSel: string) => {
    const tile = document.querySelector(activeTileSel);
    return (
      tile
        ?.querySelector("[data-terminal-id]")
        ?.getAttribute("data-terminal-id") ??
      tile?.getAttribute("data-terminal-id") ??
      null
    );
  }, ACTIVE_CANVAS_TILE_SELECTOR);
  if (!id) throw new Error("No active canvas tile to save");
  this.savedActiveTerminalId = id;
});

async function waitForSavedActiveTileStillActive(world: KoluWorld) {
  const saved = world.savedActiveTerminalId;
  if (!saved) throw new Error("No saved active canvas tile id");
  await world.page.waitForFunction(
    ({
      activeTileSel,
      savedId,
    }: {
      activeTileSel: string;
      savedId: string;
    }) => {
      const activeWrapper = document.querySelector(activeTileSel);
      if (!activeWrapper) return false;
      const inner = activeWrapper.querySelector("[data-terminal-id]");
      const activeId =
        inner?.getAttribute("data-terminal-id") ??
        activeWrapper.getAttribute("data-terminal-id");
      return activeId === savedId;
    },
    { activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR, savedId: saved },
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the saved active canvas tile should still be active",
  async function (this: KoluWorld) {
    await waitForSavedActiveTileStillActive(this);
  },
);

Given(
  "session.get's first yield is delayed by {int} ms to force the active-id race",
  async function (this: KoluWorld, ms: number) {
    // Plain-string init script: Playwright pipes function-form scripts
    // through esbuild, which inserts `__name(fn, "…")` for name-preservation
    // and crashes in the page context with `__name is not defined`. The
    // hook itself isn't TypeScript-heavy enough to need transpilation, so
    // a hand-written IIFE sidesteps the toolchain entirely.
    await this.page.addInitScript(`(() => {
      const Original = globalThis.WebSocket;
      const SESSION_TAG = "surface/padi/session/get";
      const DELAY_MS = ${ms};
      function parseNdjson(text) {
        const out = [];
        for (const line of text.split("\\n")) {
          if (!line) continue;
          try { out.push(JSON.parse(line)); } catch {}
        }
        return out;
      }
      async function frameText(data) {
        if (typeof data === "string") return data;
        if (data instanceof Blob) return await data.text();
        if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
        if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
        return null;
      }
      function PatchedWebSocket(url, protocols) {
        const ws = new Original(url, protocols);
        if (!String(url).includes("/rpc/ws")) return ws;
        const sessionIds = new Set();
        const seenFirstFrame = new Set();
        const origSend = ws.send.bind(ws);
        ws.send = (data) => {
          if (typeof data === "string") {
            for (const msg of parseNdjson(data)) {
              if (msg && msg._tag === "Request" && msg.tag === SESSION_TAG) {
                sessionIds.add(msg.id);
              }
            }
          }
          return origSend(data);
        };
        const origAdd = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, listener, options) => {
          if (type !== "message" || typeof listener !== "function") {
            return origAdd(type, listener, options);
          }
          const wrapped = async (event) => {
            try {
              const text = await frameText(event.data);
              if (text !== null) {
                for (const msg of parseNdjson(text)) {
                  if (
                    msg && msg._tag === "Chunk" &&
                    sessionIds.has(msg.requestId) &&
                    !seenFirstFrame.has(msg.requestId)
                  ) {
                    seenFirstFrame.add(msg.requestId);
                    await new Promise((r) => setTimeout(r, DELAY_MS));
                  }
                }
              }
            } catch {}
            listener.call(ws, event);
          };
          return origAdd(type, wrapped, options);
        };
        return ws;
      }
      PatchedWebSocket.prototype = Original.prototype;
      Object.setPrototypeOf(PatchedWebSocket, Original);
      globalThis.WebSocket = PatchedWebSocket;
    })();`);
  },
);

async function readCanvasViewportAttr(world: KoluWorld): Promise<string> {
  return await world.page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="canvas-container"]',
    ) as HTMLElement | null;
    return container?.getAttribute("data-viewport") ?? "";
  });
}

When("I record the canvas transform", async function (this: KoluWorld) {
  (this as unknown as { __canvasTransform?: string }).__canvasTransform =
    await readCanvasViewportAttr(this);
});

When(
  "I scroll the wheel over the terminal tile",
  async function (this: KoluWorld) {
    await waitForXterm(this);
    await this.page.evaluate(() => {
      const xterm = document.querySelector(
        "[data-visible] .xterm-screen",
      ) as HTMLElement | null;
      if (!xterm) throw new Error("xterm-screen not found");
      const rect = xterm.getBoundingClientRect();
      xterm.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 120,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await this.waitForFrame();
  },
);

When(
  "I scroll the wheel over the canvas background",
  async function (this: KoluWorld) {
    await waitForCanvas(this);
    await this.page.evaluate((sel: string) => {
      const container = document.querySelector(sel) as HTMLElement | null;
      if (!container) throw new Error("canvas-container not found");
      const rect = container.getBoundingClientRect();
      container.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 120,
          clientX: rect.left + 8,
          clientY: rect.top + 8,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, CANVAS_SELECTOR);
    await this.waitForFrame();
  },
);

When(
  "I scroll the wheel over the terminal tile within the idle window",
  async function (this: KoluWorld) {
    await waitForCanvas(this);
    await waitForXterm(this);
    await this.page.evaluate((sel: string) => {
      const container = document.querySelector(sel) as HTMLElement | null;
      const xterm = document.querySelector(
        "[data-visible] .xterm-screen",
      ) as HTMLElement | null;
      if (!container) throw new Error("canvas-container not found");
      if (!xterm) throw new Error("xterm-screen not found");
      (
        window as unknown as { __xtermWheelReceived?: boolean }
      ).__xtermWheelReceived = false;
      xterm.addEventListener(
        "wheel",
        () => {
          (
            window as unknown as { __xtermWheelReceived?: boolean }
          ).__xtermWheelReceived = true;
        },
        { once: true },
      );
      const containerRect = container.getBoundingClientRect();
      container.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 120,
          clientX: containerRect.left + 8,
          clientY: containerRect.top + 8,
          bubbles: true,
          cancelable: true,
        }),
      );
      const rect = xterm.getBoundingClientRect();
      xterm.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 120,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, CANVAS_SELECTOR);
    await this.waitForFrame();
  },
);

When(
  "I Shift+scroll the wheel over the terminal tile",
  async function (this: KoluWorld) {
    await waitForXterm(this);
    await this.page.evaluate(() => {
      const xterm = document.querySelector(
        "[data-visible] .xterm-screen",
      ) as HTMLElement | null;
      if (!xterm) throw new Error("xterm-screen not found");
      const rect = xterm.getBoundingClientRect();
      xterm.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: 0,
          deltaY: 120,
          shiftKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await this.waitForFrame();
  },
);

When(
  "I Shift+drag from inside the terminal tile",
  async function (this: KoluWorld) {
    await waitForXterm(this);
    await this.page.evaluate(() => {
      const xterm = document.querySelector(
        "[data-visible] .xterm-screen",
      ) as HTMLElement | null;
      if (!xterm) throw new Error("xterm-screen not found");
      const rect = xterm.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      xterm.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          shiftKey: true,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          shiftKey: true,
          clientX: cx + 60,
          clientY: cy + 40,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 0,
          clientX: cx + 60,
          clientY: cy + 40,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await this.waitForFrame();
  },
);

Then(
  "xterm should not have received a wheel event",
  async function (this: KoluWorld) {
    const received = await this.page.evaluate(
      () =>
        (window as unknown as { __xtermWheelReceived?: boolean })
          .__xtermWheelReceived === true,
    );
    if (received) {
      throw new Error(
        "xterm received a wheel event — canvas ownership failed to suppress it",
      );
    }
  },
);

Then(
  "the canvas transform should not have changed",
  async function (this: KoluWorld) {
    const before = (this as unknown as { __canvasTransform?: string })
      .__canvasTransform;
    const after = await readCanvasViewportAttr(this);
    if (before !== after) {
      throw new Error(
        `Canvas transform changed unexpectedly: ${before} → ${after}`,
      );
    }
  },
);

Then(
  "the canvas transform should have changed",
  async function (this: KoluWorld) {
    const before = (this as unknown as { __canvasTransform?: string })
      .__canvasTransform;
    await this.page.waitForFunction(
      (prev: string) => {
        const container = document.querySelector(
          '[data-testid="canvas-container"]',
        ) as HTMLElement | null;
        return (
          container !== null && container.getAttribute("data-viewport") !== prev
        );
      },
      before ?? "",
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the minimap should be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    MINIMAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then("the minimap map should be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    MINIMAP_MAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

async function getTileIds(world: KoluWorld): Promise<string[]> {
  return world.page.evaluate(
    (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .map((el) => (el as HTMLElement).getAttribute("data-terminal-id"))
        .filter((id): id is string => id !== null),
    TILE_SELECTOR,
  );
}

When(
  "I stack every canvas tile in a tall, narrow column",
  async function (this: KoluWorld) {
    const ids = await getTileIds(this);
    if (ids.length === 0) throw new Error("No canvas tiles to stack");
    const STACK_X = 200;
    const TALL_GAP_PX = 6000;
    for (const [i, id] of ids.entries()) {
      await setCanvasLayoutById(this, id, STACK_X, i * TALL_GAP_PX);
    }
  },
);

Then(
  "the minimap zoom bar should not clip its controls",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const bar = document.querySelector(sel) as HTMLElement | null;
        if (!bar) return false;
        return bar.scrollWidth <= bar.clientWidth + 1;
      },
      MINIMAP_ZOOMBAR_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I save the canvas viewport state", async function (this: KoluWorld) {
  const state = await this.page.evaluate((sel: string) => {
    const container = document.querySelector(sel) as HTMLElement | null;
    if (!container) return null;
    return {
      zoom: container.getAttribute("data-zoom"),
      transform: container.getAttribute("data-viewport"),
    };
  }, CANVAS_SELECTOR);
  this.savedViewportState = state;
});

When("I drag the minimap viewport rect", async function (this: KoluWorld) {
  await this.page.evaluate(
    ({ mapSel, viewSel }: { mapSel: string; viewSel: string }) => {
      const map = document.querySelector(mapSel) as HTMLElement | null;
      const view = document.querySelector(viewSel) as HTMLElement | null;
      if (!map) throw new Error("Minimap map not visible");
      if (!view) throw new Error("Viewport rect not visible");
      const box = view.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      map.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          clientX: cx + 30,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 0,
          clientX: cx + 30,
          clientY: cy,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { mapSel: MINIMAP_MAP_SELECTOR, viewSel: MINIMAP_VIEWPORT_RECT_SELECTOR },
  );
  await this.waitForFrame();
});

Then(
  "the canvas viewport state should have changed",
  async function (this: KoluWorld) {
    const saved = this.savedViewportState;
    await this.page.waitForFunction(
      (prev: { transform: string | null }) => {
        const container = document.querySelector(
          '[data-testid="canvas-container"]',
        ) as HTMLElement | null;
        return (
          container !== null &&
          container.getAttribute("data-viewport") !== prev.transform
        );
      },
      { transform: saved?.transform ?? null },
      { timeout: POLL_TIMEOUT },
    );
  },
);

async function pressCanvasTile(
  world: KoluWorld,
  index: number,
  type: "mousedown" | "dblclick",
): Promise<void> {
  await world.page.evaluate(
    ({ sel, i, kind }: { sel: string; i: number; kind: string }) => {
      const shell = document
        .querySelectorAll(sel)
        .item(i) as HTMLElement | null;
      if (!shell) throw new Error(`canvas tile ${i + 1} not found`);
      const target =
        (shell.querySelector(
          "[data-terminal-id][data-visible]",
        ) as HTMLElement | null) ?? shell;
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent(kind, {
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { sel: TILE_SELECTOR, i: index - 1, kind: type },
  );
  await world.waitForFrame();
}

When(
  "I click canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    await pressCanvasTile(this, index, "mousedown");
  },
);

Then(
  "exactly {int} canvas tile(s) should use the webgl renderer",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: number }) => {
        const tiles = document.querySelectorAll(
          `${sel} [data-terminal-id][data-renderer="webgl"]`,
        );
        return tiles.length === want;
      },
      { sel: CANVAS_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "canvas tile {int} should use the {word} renderer",
  async function (this: KoluWorld, index: number, want: string) {
    await this.page.waitForFunction(
      ({ sel, i, w }: { sel: string; i: number; w: string }) => {
        const tile = document
          .querySelectorAll(sel)
          .item(i)
          ?.querySelector(
            "[data-terminal-id][data-visible]:not([data-sub-terminal])",
          ) as HTMLElement | null;
        return tile?.getAttribute("data-renderer") === w;
      },
      { sel: TILE_SELECTOR, i: index - 1, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the main terminal should use the {word} renderer",
  async function (this: KoluWorld, want: string) {
    await this.page.waitForFunction(
      ({ activeTileSel, w }: { activeTileSel: string; w: string }) => {
        const main = document.querySelector(
          `${activeTileSel} [data-terminal-id][data-visible]:not([data-sub-terminal])`,
        );
        return main?.getAttribute("data-renderer") === w;
      },
      { activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the focused sub-terminal should use the {word} renderer",
  async function (this: KoluWorld, want: string) {
    await this.page.waitForFunction(
      ({ activeTileSel, w }: { activeTileSel: string; w: string }) => {
        const sub = document.querySelector(
          `${activeTileSel} [data-sub-terminal][data-visible]`,
        );
        return sub?.getAttribute("data-renderer") === w;
      },
      { activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click minimap tile rect {int}",
  async function (this: KoluWorld, index: number) {
    await this.page.evaluate((i: number) => {
      const rect = document
        .querySelectorAll('[data-testid="minimap-tile-rect"]')
        .item(i) as HTMLElement | null;
      if (!rect) throw new Error(`minimap tile rect ${i + 1} not found`);
      rect.click();
    }, index - 1);
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} should be the active tile",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      ({
        sel,
        activeTileSel,
        i,
      }: {
        sel: string;
        activeTileSel: string;
        i: number;
      }) => {
        const tile = document
          .querySelectorAll(sel)
          .item(i) as HTMLElement | null;
        if (!tile) return false;
        return tile.matches(activeTileSel);
      },
      {
        sel: TILE_SELECTOR,
        activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR,
        i: index - 1,
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

async function readFirstTilePosition(
  world: KoluWorld,
): Promise<{ id: string; left: number; top: number }> {
  return readCanvasTilePosition(world, 1);
}

async function readCanvasTilePosition(
  world: KoluWorld,
  index: number,
): Promise<{ id: string; left: number; top: number }> {
  const result = await world.page.evaluate(
    ({ sel, index }: { sel: string; index: number }) => {
      const tile = document.querySelectorAll(sel)[index - 1] as
        | HTMLElement
        | undefined;
      const id = tile?.getAttribute("data-terminal-id");
      if (!tile || !id) return null;
      return {
        id,
        left: parseFloat(tile.style.left),
        top: parseFloat(tile.style.top),
      };
    },
    { sel: TILE_SELECTOR, index },
  );
  if (!result) throw new Error("No canvas tile found");
  return result;
}

When(
  "I save canvas tile {int} position",
  async function (this: KoluWorld, index: number) {
    this.savedCanvasTilePositions ??= {};
    this.savedCanvasTilePositions[index] = await readCanvasTilePosition(
      this,
      index,
    );
  },
);

When(
  "I drag minimap tile rect {int} by x={int} y={int}",
  async function (this: KoluWorld, index: number, dx: number, dy: number) {
    const saved = this.savedCanvasTilePositions?.[index];
    if (!saved) throw new Error(`No saved canvas tile ${index} position`);
    await this.page.evaluate(
      ({ tileId, dx, dy }: { tileId: string; dx: number; dy: number }) => {
        const rect = document.querySelector(
          `[data-testid="minimap-tile-rect"][data-tile-id="${tileId}"]`,
        ) as HTMLElement | null;
        if (!rect) throw new Error(`minimap tile rect ${tileId} not found`);
        const box = rect.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const eventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        };
        rect.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...eventInit,
            clientX: cx,
            clientY: cy,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...eventInit,
            clientX: cx + dx,
            clientY: cy + dy,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            ...eventInit,
            clientX: cx + dx,
            clientY: cy + dy,
          }),
        );
      },
      { tileId: saved.id, dx, dy },
    );
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} position should have changed",
  async function (this: KoluWorld, index: number) {
    const saved = this.savedCanvasTilePositions?.[index];
    if (!saved) throw new Error(`No saved canvas tile ${index} position`);
    await this.page.waitForFunction(
      ({
        sel,
        tileId,
        left,
        top,
      }: {
        sel: string;
        tileId: string;
        left: number;
        top: number;
      }) => {
        const tile = document
          .querySelector(`${sel} [data-terminal-id="${tileId}"]`)
          ?.closest("[style*='left']") as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.left) - left) >= 1 ||
          Math.abs(parseFloat(tile.style.top) - top) >= 1
        );
      },
      {
        sel: CANVAS_SELECTOR,
        tileId: saved.id,
        left: saved.left,
        top: saved.top,
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I move every canvas tile to a distinct scattered position",
  async function (this: KoluWorld) {
    const SCATTER = [
      { x: 220, y: 160 },
      { x: 2860, y: 360 },
      { x: 360, y: 2420 },
      { x: 3040, y: 2580 },
      { x: 1500, y: 1180 },
    ];
    const ids = await getTileIds(this);
    if (ids.length === 0) throw new Error("No canvas tiles to scatter");
    for (const [i, id] of ids.entries()) {
      const pos = SCATTER[i % SCATTER.length];
      if (!pos) continue;
      await setCanvasLayoutById(this, id, pos.x, pos.y);
    }
  },
);

When("I record all canvas tile positions", async function (this: KoluWorld) {
  this.recordedTilePositions = await this.page.evaluate((sel: string) => {
    const out: Record<string, { left: number; top: number }> = {};
    for (const el of document.querySelectorAll(sel)) {
      const tile = el as HTMLElement;
      const id = tile.getAttribute("data-terminal-id");
      if (!id) continue;
      out[id] = {
        left: parseFloat(tile.style.left),
        top: parseFloat(tile.style.top),
      };
    }
    return out;
  }, TILE_SELECTOR);
});

Then(
  "previously-recorded canvas tiles should not have moved",
  async function (this: KoluWorld) {
    const recorded = this.recordedTilePositions;
    if (!recorded || Object.keys(recorded).length === 0) {
      throw new Error("No recorded canvas tile positions to compare against");
    }
    await this.page.waitForFunction(
      ({
        sel,
        recorded,
      }: {
        sel: string;
        recorded: Record<string, { left: number; top: number }>;
      }) => {
        for (const [id, pos] of Object.entries(recorded)) {
          const tile = document
            .querySelector(`${sel} [data-terminal-id="${id}"]`)
            ?.closest("[style*='left']") as HTMLElement | null;
          if (!tile) return false;
          if (Math.abs(parseFloat(tile.style.left) - pos.left) >= 1)
            return false;
          if (Math.abs(parseFloat(tile.style.top) - pos.top) >= 1) return false;
        }
        return true;
      },
      { sel: CANVAS_SELECTOR, recorded },
      { timeout: POLL_TIMEOUT },
    );
  },
);

async function setCanvasLayoutById(
  world: KoluWorld,
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const layout = { x, y, w: 700, h: 500 };
  await padiCall("chrome/setCanvasLayout", { id, layout });
  await world.page.waitForFunction(
    ({
      sel,
      tileId,
      wantX,
      wantY,
    }: {
      sel: string;
      tileId: string;
      wantX: number;
      wantY: number;
    }) => {
      const tile = document
        .querySelector(`${sel} [data-terminal-id="${tileId}"]`)
        ?.closest("[style*='left']") as HTMLElement | null;
      if (!tile) return false;
      return (
        Math.abs(parseFloat(tile.style.left) - wantX) < 1 &&
        Math.abs(parseFloat(tile.style.top) - wantY) < 1
      );
    },
    { sel: CANVAS_SELECTOR, tileId: id, wantX: x, wantY: y },
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "I move the canvas tile to x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const { id } = await readFirstTilePosition(this);
    await setCanvasLayoutById(this, id, x, y);
  },
);

When(
  "I move canvas tile {int} to x={int} y={int}",
  async function (this: KoluWorld, index: number, x: number, y: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await setCanvasLayoutById(this, id, x, y);
  },
);

Then(
  "the canvas tile should be at x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    await this.page.waitForFunction(
      ({
        sel,
        wantX,
        wantY,
      }: {
        sel: string;
        wantX: number;
        wantY: number;
      }) => {
        const tile = document.querySelector(sel) as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.left) - wantX) < 1 &&
          Math.abs(parseFloat(tile.style.top) - wantY) < 1
        );
      },
      { sel: TILE_SELECTOR, wantX: x, wantY: y },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I double-click the empty canvas background",
  async function (this: KoluWorld) {
    await waitForCanvas(this);
    await this.page.evaluate((sel: string) => {
      const container = document.querySelector(sel) as HTMLElement | null;
      if (!container) throw new Error("canvas-container not found");
      container.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    }, CANVAS_SELECTOR);
    await this.waitForFrame();
  },
);

When(
  "I double-click canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    await pressCanvasTile(this, index, "dblclick");
  },
);

When(
  "I double-click the title bar of canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    await this.page.evaluate((i) => {
      const bars = document.querySelectorAll(
        '[data-testid="canvas-tile-titlebar"]',
      );
      const bar = bars.item(i) as HTMLElement | null;
      if (!bar) throw new Error(`titlebar ${i + 1} not found`);
      bar.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    }, index - 1);
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} should be maximized",
  async function (this: KoluWorld, _index: number) {
    const maximizedTile = this.page.locator(
      `${CANVAS_TILE_SELECTOR}[data-maximized="true"]`,
    );
    await maximizedTile
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then("no canvas tile should be maximized", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => {
      const tiles = document.querySelectorAll(sel);
      return ![...tiles].some(
        (t) => t.getAttribute("data-maximized") === "true",
      );
    },
    CANVAS_TILE_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click the chrome-bar maximize toggle",
  async function (this: KoluWorld) {
    const maximized = this.page.locator('[data-testid="mode-maximized"]');
    await maximized.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const already = (await maximized.getAttribute("data-active")) !== null;
    await this.page
      .locator(
        already
          ? '[data-testid="mode-canvas"]'
          : '[data-testid="mode-maximized"]',
      )
      .click();
    await this.waitForFrame();
  },
);

Then(
  "every non-maximized canvas tile should be hidden",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const covered = [...document.querySelectorAll(sel)].filter(
          (t) => t.getAttribute("data-maximized") !== "true",
        );
        return (
          covered.length > 0 &&
          covered.every(
            (t) => getComputedStyle(t as HTMLElement).visibility === "hidden",
          )
        );
      },
      CANVAS_TILE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

const notedTileBoxes = new Map<string, { width: number; height: number }>();

When("I note every canvas tile's box", async function (this: KoluWorld) {
  const boxes = await this.page.evaluate(
    (sel: string) =>
      [...document.querySelectorAll(sel)].map((t) => ({
        id: t.getAttribute("data-terminal-id") ?? "",
        width: (t as HTMLElement).offsetWidth,
        height: (t as HTMLElement).offsetHeight,
      })),
    CANVAS_TILE_SELECTOR,
  );
  notedTileBoxes.clear();
  for (const { id, ...box } of boxes) notedTileBoxes.set(id, box);
  assert.ok(notedTileBoxes.size > 0, "no canvas tiles to note");
});

Then(
  "every covered canvas tile should keep the box it had",
  async function (this: KoluWorld) {
    const noted = [...notedTileBoxes.entries()].map(([id, box]) => ({
      id,
      ...box,
    }));
    await this.page.waitForFunction(
      ({ sel, noted }) => {
        const tiles = [...document.querySelectorAll(sel)] as HTMLElement[];
        const maximized = tiles.find(
          (t) => t.getAttribute("data-maximized") === "true",
        );
        if (!maximized) return false;
        const covered = tiles.filter((t) => t !== maximized);
        if (covered.length === 0) return false;
        return covered.every((t) => {
          const was = noted.find(
            (n) => n.id === t.getAttribute("data-terminal-id"),
          );
          if (!was) return false;
          return (
            Math.abs(t.offsetWidth - was.width) <= 1 &&
            Math.abs(t.offsetHeight - was.height) <= 1
          );
        });
      },
      { sel: CANVAS_TILE_SELECTOR, noted },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I tag canvas tile {int}'s xterm element",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(sel)
          .item(i) as HTMLElement | null;
        return tile?.querySelector(".xterm") != null;
      },
      { sel: TILE_SELECTOR, i: index - 1 },
      { timeout: POLL_TIMEOUT },
    );
    await this.page.evaluate(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(sel)
          .item(i) as HTMLElement | null;
        const xterm = tile?.querySelector(".xterm") as HTMLElement | null;
        if (!xterm) throw new Error(`xterm element in tile ${i + 1} not found`);
        const tag = `xterm-${Date.now()}-${Math.random()}`;
        xterm.setAttribute("data-stability-tag", tag);
        (
          window as unknown as { __xtermStabilityTag?: string }
        ).__xtermStabilityTag = tag;
      },
      { sel: TILE_SELECTOR, i: index - 1 },
    );
  },
);

Then("some canvas tile should be maximized", async function (this: KoluWorld) {
  const maximizedTile = this.page.locator(
    `${CANVAS_TILE_SELECTOR}[data-maximized="true"]`,
  );
  await maximizedTile
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the tagged xterm element should still exist in the DOM",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const tag = (window as unknown as { __xtermStabilityTag?: string })
          .__xtermStabilityTag;
        if (!tag) return false;
        return (
          document.querySelector(`.xterm[data-stability-tag="${tag}"]`) !== null
        );
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the page should not scroll", async function (this: KoluWorld) {
  const seen = await this.page.evaluate(() => {
    const root = document.documentElement;
    const past: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const box = el.getBoundingClientRect();
      if (box.height > 40 && box.bottom > window.innerHeight + 2) {
        past.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} bottom=${Math.round(box.bottom)}`,
        );
      }
    }
    return {
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      past: past.slice(0, 5),
    };
  });
  assert.equal(
    seen.scrollHeight,
    seen.clientHeight,
    `the document is ${seen.scrollHeight}px tall in a ${seen.clientHeight}px window — ${seen.past.join(" · ") || "no single element runs past the fold, so the overflow is a wrapper's own box"}`,
  );
  assert.equal(
    seen.scrollWidth,
    seen.clientWidth,
    `the document is ${seen.scrollWidth}px wide in a ${seen.clientWidth}px window`,
  );
});

const parked = new Map<
  KoluWorld,
  { id: string; left: number; top: number; marker?: string }
>();

function parkedTile(world: KoluWorld) {
  const tile = parked.get(world);
  assert.ok(tile, "No parked canvas tile — park one out of view first");
  return tile;
}

const paneOf = (id: string) =>
  `${CANVAS_TILE_SELECTOR}[data-terminal-id="${id}"] [data-terminal-id][data-font-size]:not([data-sub-terminal])`;

const marker = (kind: string, stamp: number) => ({
  text: `kolu-e2e-${kind}-${stamp}`,
  input: `printf '%s%s\\n' 'kolu-e2e' '-${kind}-${stamp}'\r`,
});

When(
  "I move canvas tile {int} far out of view",
  async function (this: KoluWorld, index: number) {
    const pos = await readCanvasTilePosition(this, index);
    parked.set(this, pos);
    await setCanvasLayoutById(this, pos.id, pos.left + 6000, pos.top + 4000);
  },
);

When("I take over the page clock", async function (this: KoluWorld) {
  await this.page.clock.install();
});

const SEEN_HOLD_MS = 60 * 60_000;

When("the grace period passes", async function (this: KoluWorld) {
  await this.page.clock.fastForward(SEEN_HOLD_MS + 60_000);
});

When(
  "I move the parked canvas tile back into view",
  async function (this: KoluWorld) {
    const tile = parkedTile(this);
    await setCanvasLayoutById(this, tile.id, tile.left, tile.top);
  },
);

async function waitForParkedPaneShown(world: KoluWorld): Promise<void> {
  const { id } = parkedTile(world);
  await world.page
    .locator(`${paneOf(id)}[data-visible]`)
    .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
}

Then(
  "the parked canvas tile should still be taking live output",
  async function (this: KoluWorld) {
    await waitForParkedPaneShown(this);
  },
);

Then(
  "the parked canvas tile should stop taking live output",
  async function (this: KoluWorld) {
    const { id } = parkedTile(this);
    await this.page.waitForFunction(
      ({ shell, shown }: { shell: string; shown: string }) =>
        document.querySelector(shell) !== null &&
        document.querySelector(shown) === null,
      {
        shell: `${CANVAS_TILE_SELECTOR}[data-terminal-id="${id}"]`,
        shown: `${paneOf(id)}[data-visible]`,
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the parked canvas tile should take live output again",
  async function (this: KoluWorld) {
    await waitForParkedPaneShown(this);
  },
);

When(
  "I print a marker in the parked canvas tile",
  async function (this: KoluWorld) {
    const tile = parkedTile(this);
    const stamp = Date.now();
    const printed = marker("parked", stamp);
    parked.set(this, { ...tile, marker: printed.text });
    await padiCall("lifecycle/sendInput", {
      id: tile.id,
      data: printed.input,
    });
    const fenceId = await this.page.evaluate((parkedId: string) => {
      const panes = document.querySelectorAll(
        "[data-terminal-id][data-font-size][data-visible]:not([data-sub-terminal])",
      );
      for (const pane of panes) {
        const other = pane.getAttribute("data-terminal-id");
        if (other && other !== parkedId) return other;
      }
      return null;
    }, tile.id);
    assert.ok(fenceId, "No attached terminal to fence the parked one against");
    const fence = marker("fence", stamp);
    await padiCall("lifecycle/sendInput", { id: fenceId, data: fence.input });
    await waitForBufferContains(this.page, fence.text, {
      selector: paneOf(fenceId),
    });
  },
);

Then(
  "the parked canvas tile should not show the marker",
  async function (this: KoluWorld) {
    const { id, marker: printed } = parkedTile(this);
    assert.ok(printed, "No marker printed — print one first");
    const screen = await readBufferText(this.page, paneOf(id));
    assert.ok(
      !screen.includes(printed),
      `the parked tile holds "${printed}", so it was still taking output with nobody looking at it`,
    );
  },
);

Then(
  "the parked canvas tile should show the marker",
  async function (this: KoluWorld) {
    const { id, marker: printed } = parkedTile(this);
    assert.ok(printed, "No marker printed — print one first");
    await waitForBufferContains(this.page, printed, { selector: paneOf(id) });
  },
);
