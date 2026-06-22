import * as assert from "node:assert";
import { Given, Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const MINIMAP_SELECTOR = '[data-testid="canvas-minimap"]';
const MINIMAP_MAP_SELECTOR = '[data-testid="minimap-map"]';
const MINIMAP_VIEWPORT_RECT_SELECTOR = '[data-testid="minimap-viewport-rect"]';
const MINIMAP_ZOOMBAR_SELECTOR = '[data-testid="minimap-zoombar"]';
const TILE_SELECTOR = '[data-testid="canvas-tile"]';

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
        const bg = document.querySelector(sel);
        if (!bg) return false;
        const tiles = bg.querySelectorAll("[data-terminal-id][data-visible]");
        return tiles.length === count;
      },
      { sel: CANVAS_SELECTOR, count: expected },
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
    // Canvas tiles each have a close button in the title bar.
    // Find tile containers inside the canvas — each tile is an absolute-positioned
    // div that wraps a [data-terminal-id][data-visible] element.
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
        const tile = container.querySelector(
          "[data-terminal-id][data-visible]",
        );
        if (!tile) return false;
        const cRect = container.getBoundingClientRect();
        const tRect = tile.getBoundingClientRect();
        // Tile should overlap with the visible container area (transformed canvas)
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
  // Capture zoom before so we can assert it changed
  const before = await this.page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return parseFloat(el?.getAttribute("data-zoom") ?? "1");
  }, CANVAS_SELECTOR);
  this.zoomBefore = before;
  const container = this.page.locator(CANVAS_SELECTOR);
  await container.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  // Dispatch a ctrl+wheel event to trigger zoom (negative deltaY = zoom in).
  // Playwright's mouse.wheel doesn't support modifier keys, so we dispatch
  // the WheelEvent directly from the page context.
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

/** Poll until the picked tile's bounding-box center matches the canvas
 *  container's center within grid-snap tolerance. `pick` chooses which
 *  tile: "newest" = last in DOM order (waits for ≥2 to exist),
 *  "active" = the one carrying `data-active="true"`. */
async function waitForTileCenteredInViewport(
  world: KoluWorld,
  pick: "newest" | "active",
) {
  await world.page.waitForFunction(
    ({ sel, pick }: { sel: string; pick: "newest" | "active" }) => {
      const container = document.querySelector(sel);
      if (!container) return false;
      let tile: HTMLElement | null;
      if (pick === "newest") {
        const tiles = container.querySelectorAll(
          "[data-terminal-id][data-visible]",
        );
        if (tiles.length < 2) return false;
        tile = tiles[tiles.length - 1] as HTMLElement;
      } else {
        tile = container.querySelector('[data-active="true"]');
      }
      if (!tile) return false;
      const cRect = container.getBoundingClientRect();
      const tRect = tile.getBoundingClientRect();
      const tileCx = tRect.left + tRect.width / 2 - cRect.left;
      const tileCy = tRect.top + tRect.height / 2 - cRect.top;
      const viewCx = cRect.width / 2;
      const viewCy = cRect.height / 2;
      const tolerance = 40; // grid snap (24px) + rounding
      return (
        Math.abs(tileCx - viewCx) < tolerance &&
        Math.abs(tileCy - viewCy) < tolerance
      );
    },
    { sel: CANVAS_SELECTOR, pick },
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
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await this.page.keyboard.down(modifier);
    await this.page.keyboard.press("t");
    await this.page.keyboard.up(modifier);
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} should be offset from canvas tile {int}",
  async function (this: KoluWorld, a: number, b: number) {
    await this.page.waitForFunction(
      ({ sel, i, j }: { sel: string; i: number; j: number }) => {
        const tiles = document.querySelectorAll(
          `${sel} [data-terminal-id][data-visible]`,
        );
        const tileA = tiles.item(i) as HTMLElement | null;
        const tileB = tiles.item(j) as HTMLElement | null;
        if (!tileA || !tileB) return false;
        const rA = tileA.getBoundingClientRect();
        const rB = tileB.getBoundingClientRect();
        // Snapped top-left must differ on both axes (cascade is diagonal).
        return Math.abs(rA.left - rB.left) > 1 && Math.abs(rA.top - rB.top) > 1;
      },
      { sel: CANVAS_SELECTOR, i: a - 1, j: b - 1 },
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
      const tiles = Array.from(
        document.querySelectorAll(`${sel} [data-terminal-id][data-visible]`),
      ).map((t) => {
        const wrapper = (t as HTMLElement).closest(
          "[style*='left']",
        ) as HTMLElement | null;
        return (wrapper ?? (t as HTMLElement)).getBoundingClientRect();
      });
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i];
          const b = tiles[j];
          if (!a || !b) continue;
          // 2 px tolerance: tiles touching at exact grid edges shouldn't
          // count as overlapping.
          const overlapX = a.left < b.right - 2 && a.right - 2 > b.left;
          const overlapY = a.top < b.bottom - 2 && a.bottom - 2 > b.top;
          if (overlapX && overlapY) return false;
        }
      }
      return true;
    },
    CANVAS_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When("I save the active canvas tile id", async function (this: KoluWorld) {
  const id = await this.page.evaluate((sel: string) => {
    const tile = document
      .querySelector(sel)
      ?.querySelector('[data-active="true"]');
    return (
      tile
        ?.querySelector("[data-terminal-id]")
        ?.getAttribute("data-terminal-id") ??
      tile?.getAttribute("data-terminal-id") ??
      null
    );
  }, CANVAS_SELECTOR);
  if (!id) throw new Error("No active canvas tile to save");
  this.savedActiveTerminalId = id;
});

async function waitForSavedActiveTileStillActive(world: KoluWorld) {
  const saved = world.savedActiveTerminalId;
  if (!saved) throw new Error("No saved active canvas tile id");
  await world.page.waitForFunction(
    ({ sel, savedId }: { sel: string; savedId: string }) => {
      // The active tile's CanvasTile wrapper carries data-active="true".
      // Its inner Terminal element carries data-terminal-id. Walk down
      // from the active wrapper rather than checking every tile —
      // that makes "did active flip to a different tile" the failure
      // mode, not "is savedId still in the DOM" (it always is).
      const activeWrapper = document
        .querySelector(sel)
        ?.querySelector('[data-active="true"]');
      if (!activeWrapper) return false;
      const inner = activeWrapper.querySelector("[data-terminal-id]");
      const activeId =
        inner?.getAttribute("data-terminal-id") ??
        activeWrapper.getAttribute("data-terminal-id");
      return activeId === savedId;
    },
    { sel: CANVAS_SELECTOR, savedId: saved },
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the saved active canvas tile should still be active",
  async function (this: KoluWorld) {
    await waitForSavedActiveTileStillActive(this);
  },
);

// Deterministic race-forcer. Installs a Playwright init script that runs
// before every subsequent navigation and patches `window.WebSocket` so the
// first EVENT_ITERATOR yield for `/surface/kolu/session/get` is held for `ms`
// before being dispatched. `terminalList.get`'s first yield reaches the
// surface client unblocked, so the canvas first-mount centering effect
// (`TerminalCanvas.tsx:331`) always observes a null `activeId`, takes the
// bbox-fallback branch, pans the viewport, and the `isDefaultViewport()`
// guard latches the bug for the rest of the session — exactly the
// production race described in `useSessionRestore.ts:178-182`, made
// deterministic. 500ms is overkill for the race window but cheap.
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
      const SESSION_PATH = "/surface/kolu/session/get";
      const DELAY_MS = ${ms};
      function readJsonHeader(bytes) {
        const delim = bytes.indexOf(255);
        const jsonBytes = delim >= 0 ? bytes.subarray(0, delim) : bytes;
        return JSON.parse(new TextDecoder().decode(jsonBytes));
      }
      function PatchedWebSocket(url, protocols) {
        const ws = new Original(url, protocols);
        if (!String(url).includes("/rpc/ws")) return ws;
        const sessionIds = new Set();
        const seenFirstYield = new Set();
        const origSend = ws.send.bind(ws);
        ws.send = (data) => {
          try {
            let msg = null;
            if (data instanceof Uint8Array) msg = readJsonHeader(data);
            else if (data instanceof ArrayBuffer) msg = readJsonHeader(new Uint8Array(data));
            else if (typeof data === "string") msg = JSON.parse(data);
            if (msg && typeof msg.p?.u === "string" && msg.p.u.includes(SESSION_PATH)) {
              sessionIds.add(msg.i);
            }
          } catch {}
          return origSend(data);
        };
        const origAdd = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, listener, options) => {
          if (type !== "message" || typeof listener !== "function") {
            return origAdd(type, listener, options);
          }
          const wrapped = async (event) => {
            try {
              const data = event.data;
              let bytes = null;
              if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
              else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
              else if (typeof data === "string") bytes = new TextEncoder().encode(data);
              if (bytes) {
                const msg = readJsonHeader(bytes);
                // EVENT_ITERATOR=3 (server pushing yields). Only delay the
                // first one per session id — subsequent updates (session
                // auto-save echoes) shouldn't be slowed.
                if (msg && msg.t === 3 && sessionIds.has(msg.i) && !seenFirstYield.has(msg.i)) {
                  seenFirstYield.add(msg.i);
                  await new Promise((r) => setTimeout(r, DELAY_MS));
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

// ── Gesture ownership: two-finger scroll on terminal must not pan the canvas ──

/** Read the canvas viewport transform string (`scale(z) translate(-pan…)`).
 *  Surfaced as `data-viewport` on the canvas-container element since #988
 *  retired the wrapper transform div in favour of per-tile composition —
 *  we still need a pan/zoom-only observable for tests (a tile's own
 *  `style.transform` also folds in layout coords + drag delta). Stable
 *  string identity is enough to prove pan/zoom did or didn't change. */
async function readCanvasTransform(world: KoluWorld): Promise<string> {
  return await world.page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="canvas-container"]',
    ) as HTMLElement | null;
    return container?.getAttribute("data-viewport") ?? "";
  });
}

When("I record the canvas transform", async function (this: KoluWorld) {
  (this as unknown as { __canvasTransform?: string }).__canvasTransform =
    await readCanvasTransform(this);
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
      // Dispatch at a corner of the container — outside any tile.
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
    // Install a one-shot probe on the xterm element before dispatching. Canvas
    // owns the gesture from the previous background scroll; stopPropagation at
    // the canvas's capture-phase listener should prevent this event from ever
    // reaching the xterm probe.
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

// ── Shift-to-pan modifier ──

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
    const after = await readCanvasTransform(this);
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

// ── Minimap steps ──

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

// Terminal ids of every visible canvas tile, in DOM order.
async function getVisibleTileIds(world: KoluWorld): Promise<string[]> {
  return world.page.evaluate(
    (sel: string) =>
      Array.from(
        document.querySelectorAll(`${sel} [data-terminal-id][data-visible]`),
      )
        .map((el) => (el as HTMLElement).getAttribute("data-terminal-id"))
        .filter((id): id is string => id !== null),
    CANVAS_SELECTOR,
  );
}

// Stack every visible canvas tile in a single column with a large vertical
// gap, so the tile bounding box becomes far taller than it is wide. That is
// the shape that collapses the minimap's shrink-to-fit width (the height
// constraint wins the scale), which used to drag the zoom bar below the
// width its controls need.
When(
  "I stack every canvas tile in a tall, narrow column",
  async function (this: KoluWorld) {
    const ids = await getVisibleTileIds(this);
    if (ids.length === 0) throw new Error("No canvas tiles to stack");
    const STACK_X = 200;
    // >> tile width (700) so the stacked column's height/width ratio (~7x) far
    // exceeds the minimap's MAP_W/MAP_H aspect (1.5), forcing the height term
    // to win the scale and collapse the map to a sliver — the exact tall-narrow
    // shape from the bug.
    const TALL_GAP_PX = 6000;
    for (const [i, id] of ids.entries()) {
      await setCanvasLayoutById(this, id, STACK_X, i * TALL_GAP_PX);
    }
  },
);

// The zoom bar lives below the map and packs fixed-width controls on one
// `overflow-hidden` row. If the panel is forced narrower than that content,
// the controls are clipped (scrollWidth exceeds clientWidth) — the bug. A
// panel that floors at the bar's natural width never overflows.
Then(
  "the minimap zoom bar should not clip its controls",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const bar = document.querySelector(sel) as HTMLElement | null;
        if (!bar) return false;
        // Sub-pixel rounding can leave a 1px discrepancy even when nothing
        // is actually clipped.
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

When(
  "I click canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    // Dispatch mousedown directly: Playwright's .click() stalls on xterm's
    // event-intercepting machinery, but CanvasTile only needs mousedown to
    // bubble up to its onSelect handler.
    await this.page.evaluate(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(`${sel} [data-terminal-id][data-visible]`)
          .item(i) as HTMLElement | null;
        if (!tile) throw new Error(`canvas tile ${i + 1} not found`);
        const rect = tile.getBoundingClientRect();
        tile.dispatchEvent(
          new MouseEvent("mousedown", {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
          }),
        );
      },
      { sel: CANVAS_SELECTOR, i: index - 1 },
    );
    await this.waitForFrame();
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

// Per-tile renderer assertion. Indexes top-level (non-sub-terminal) visible
// tiles in creation order — same ordering as "I click canvas tile {int}".
// Excludes [data-sub-terminal] so an open split pane does not shift the index
// of subsequent tiles. WebGL load/unload is async (effect + addon
// construction), so poll rather than read once. `{word}` is `webgl` or `dom`.
Then(
  "canvas tile {int} should use the {word} renderer",
  async function (this: KoluWorld, index: number, want: string) {
    await this.page.waitForFunction(
      ({ sel, i, w }: { sel: string; i: number; w: string }) => {
        const tile = document
          .querySelectorAll(
            `${sel} [data-terminal-id][data-visible]:not([data-sub-terminal])`,
          )
          .item(i) as HTMLElement | null;
        return tile?.getAttribute("data-renderer") === w;
      },
      { sel: CANVAS_SELECTOR, i: index - 1, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Main pane vs. active split of the active tile — for the active-split-inherit
// scenario, where both must end up on WebGL. The active tile carries
// data-active="true"; its main pane is the non-sub Terminal, its focused split
// is the one visible [data-sub-terminal].
Then(
  "the main terminal should use the {word} renderer",
  async function (this: KoluWorld, want: string) {
    await this.page.waitForFunction(
      ({ sel, w }: { sel: string; w: string }) => {
        const main = document.querySelector(
          `${sel} [data-active="true"] [data-terminal-id][data-visible]:not([data-sub-terminal])`,
        );
        return main?.getAttribute("data-renderer") === w;
      },
      { sel: CANVAS_SELECTOR, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the focused sub-terminal should use the {word} renderer",
  async function (this: KoluWorld, want: string) {
    await this.page.waitForFunction(
      ({ sel, w }: { sel: string; w: string }) => {
        const sub = document.querySelector(
          `${sel} [data-active="true"] [data-sub-terminal][data-visible]`,
        );
        return sub?.getAttribute("data-renderer") === w;
      },
      { sel: CANVAS_SELECTOR, w: want },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click minimap tile rect {int}",
  async function (this: KoluWorld, index: number) {
    // Dispatch click directly on the rect element. Playwright's real-mouse
    // click would land on the minimap viewport-rect overlay instead (it
    // renders on top of tile rects so users can drag it to pan).
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
      ({ sel, i }: { sel: string; i: number }) => {
        // The active tile is the one with `data-active="true"` on its
        // CanvasTile wrapper. Match by tile-rect index: find all
        // `data-terminal-id[data-visible]` descendants under the canvas
        // container and pick the nth.
        const tiles = document.querySelectorAll(
          `${sel} [data-terminal-id][data-visible]`,
        );
        const tile = tiles.item(i) as HTMLElement | null;
        if (!tile) return false;
        // Walk up to find the CanvasTile wrapper (nearest ancestor with
        // a data-active attribute, truthy or not).
        let node: HTMLElement | null = tile;
        while (node && !node.hasAttribute("data-active")) {
          node = node.parentElement;
        }
        return node?.getAttribute("data-active") === "true";
      },
      { sel: CANVAS_SELECTOR, i: index - 1 },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// "the close confirmation should be visible" is defined in worktree_steps.ts

// ── Canvas layout persistence ──

/** Read the position (style.left/top) of the first visible canvas tile. */
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
      const container = document.querySelector(sel);
      const inner = container?.querySelectorAll(
        "[data-terminal-id][data-visible]",
      )[index - 1] as HTMLElement | null;
      if (!inner) return null;
      const id = inner.getAttribute("data-terminal-id");
      const tile = inner.closest("[style*='left']") as HTMLElement | null;
      if (!tile || !id) return null;
      return {
        id,
        left: parseFloat(tile.style.left),
        top: parseFloat(tile.style.top),
      };
    },
    { sel: CANVAS_SELECTOR, index },
  );
  if (!result) throw new Error("No visible canvas tile found");
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
    // Distinct, far-apart, off-grid coordinates — deliberately NOT
    // anywhere an auto-layout would place tiles, so that ANY re-arrange on
    // the next create would visibly snap a tile off its spot and fail the
    // position-preservation assertion. Scattering is the whole point: tiles
    // sitting in auto-grid positions could be "rearranged" right back onto
    // themselves, masking the bug.
    const SCATTER = [
      { x: 220, y: 160 },
      { x: 2860, y: 360 },
      { x: 360, y: 2420 },
      { x: 3040, y: 2580 },
      { x: 1500, y: 1180 },
    ];
    const ids = await getVisibleTileIds(this);
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
    for (const inner of document.querySelectorAll(
      `${sel} [data-terminal-id][data-visible]`,
    )) {
      const id = (inner as HTMLElement).getAttribute("data-terminal-id");
      const tile = (inner as HTMLElement).closest(
        "[style*='left']",
      ) as HTMLElement | null;
      if (id && tile) {
        out[id] = {
          left: parseFloat(tile.style.left),
          top: parseFloat(tile.style.top),
        };
      }
    }
    return out;
  }, CANVAS_SELECTOR);
});

Then(
  "previously-recorded canvas tiles should not have moved",
  async function (this: KoluWorld) {
    const recorded = this.recordedTilePositions;
    if (!recorded || Object.keys(recorded).length === 0) {
      throw new Error("No recorded canvas tile positions to compare against");
    }
    // Positions are canvas-space (`style.left`/`top`) — pan/zoom rides the
    // tile's `transform`, so this is immune to the create flow recentring
    // the viewport. If creating a terminal re-arranged the island, an
    // existing tile would land at a new left/top and this never settles.
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
  const resp = await world.page.request.fetch("/rpc/terminal/setCanvasLayout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ json: { id, layout } }),
  });
  assert.ok(resp.ok(), `terminal/setCanvasLayout failed: ${resp.status()}`);
  // Wait for the tile to render at the new position — proves the metadata
  // subscription delivered the update (the mechanism that must survive refresh).
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
        const container = document.querySelector(sel);
        const inner = container?.querySelector(
          "[data-terminal-id][data-visible]",
        );
        const tile = inner?.closest("[style*='left']") as HTMLElement | null;
        if (!tile) return false;
        return (
          Math.abs(parseFloat(tile.style.left) - wantX) < 1 &&
          Math.abs(parseFloat(tile.style.top) - wantY) < 1
        );
      },
      { sel: CANVAS_SELECTOR, wantX: x, wantY: y },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Double-click to create ──

When(
  "I double-click the empty canvas background",
  async function (this: KoluWorld) {
    await waitForCanvas(this);
    // Dispatch the dblclick directly on the container so its `target` IS the
    // container — that's the "bare surface" the create handler guards on
    // (`target === currentTarget`). Mirrors the wheel-over-background step.
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
    // Dispatch on the tile's inner element: the dblclick bubbles up to the
    // canvas-container with `target !== currentTarget`, so the create guard
    // must NOT fire — the negative case for the empty-surface affordance.
    await this.page.evaluate(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(`${sel} [data-terminal-id][data-visible]`)
          .item(i) as HTMLElement | null;
        if (!tile) throw new Error(`canvas tile ${i + 1} not found`);
        tile.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        );
      },
      { sel: CANVAS_SELECTOR, i: index - 1 },
    );
    await this.waitForFrame();
  },
);

// ── Tile maximize ──

When(
  "I double-click the title bar of canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    // Synthesize a `dblclick` event directly on the title bar in page
    // context — Playwright's real-mouse dblclick contends with the
    // Workspace-switcher overlay and the parent tile's drag activator on a
    // maximized tile (its position changes from absolute → fixed mid-
    // sequence). Dispatching the event bypasses both.
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
    // Since #988, all tiles render in one stable list and the maximized
    // tile is CSS-promoted (`inset-0 z-40`) rather than rendered in a
    // separate branch. `nth(index-1)` can still resolve to a non-
    // maximized sibling of the same list, so match on `data-maximized="true"`.
    const maximizedTile = this.page.locator(
      `${TILE_SELECTOR}[data-maximized="true"]`,
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
    TILE_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click the chrome-bar maximize toggle",
  async function (this: KoluWorld) {
    const button = this.page.locator('[data-testid="maximize-toggle"]');
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await button.click();
    await this.waitForFrame();
  },
);

// A covered tile (non-maximized, in maximized posture) must hide itself via
// computed `visibility: hidden` — Playwright reports it as not visible. Before
// the fix the covered tile shared `tiledStyle()` (computed visibility
// "visible") and was only occluded by the maximized tile's z-40 cover, so this
// assertion fails; it passes once covered tiles hide intrinsically.
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
      TILE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// The load-bearing invariant of #988/#989: a covered tile's border-box is
// byte-identical to the maximized tile's, so an active-id switch in maximized
// posture is a pure visibility/z-index swap and `Terminal`'s ResizeObserver
// never fires `fit()`. Pin it here so a future edit that drifts the
// maximized/covered geometry apart (e.g. giving one a border or rounded corner
// the other lacks) re-introduces the per-switch reflow with a RED test instead
// of silently. Match each axis within 1px using the same idiom as line 267.
Then(
  "every covered canvas tile should occupy the maximized tile's box",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const tiles = [...document.querySelectorAll(sel)] as HTMLElement[];
        const maximized = tiles.find(
          (t) => t.getAttribute("data-maximized") === "true",
        );
        if (!maximized) return false;
        const m = maximized.getBoundingClientRect();
        const covered = tiles.filter((t) => t !== maximized);
        return (
          covered.length > 0 &&
          covered.every((t) => {
            const r = t.getBoundingClientRect();
            return (
              Math.abs(r.left - m.left) <= 1 &&
              Math.abs(r.top - m.top) <= 1 &&
              Math.abs(r.width - m.width) <= 1 &&
              Math.abs(r.height - m.height) <= 1
            );
          })
        );
      },
      TILE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Tile xterm-instance stability (regression for #988) ──
//
// Detect xterm.js remounts across an active-id switch in maximized mode.
// The tag is a unique attribute set on the `.xterm` DOM node — it survives
// iff the same DOM node survives. Today's broken behaviour replaces the
// node on every switch; the fix promotes a tile to maximized via CSS only,
// leaving the node intact.

When(
  "I tag canvas tile {int}'s xterm element",
  async function (this: KoluWorld, index: number) {
    // xterm.js's `onMount` awaits `document.fonts.load` before creating
    // the `.xterm` DOM node, so on a slow host the element may not exist
    // when this step first fires. Poll until it does, then tag it.
    await this.page.waitForFunction(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(`${sel} [data-terminal-id][data-visible]`)
          .item(i) as HTMLElement | null;
        return tile?.querySelector(".xterm") != null;
      },
      { sel: CANVAS_SELECTOR, i: index - 1 },
      { timeout: POLL_TIMEOUT },
    );
    await this.page.evaluate(
      ({ sel, i }: { sel: string; i: number }) => {
        const tile = document
          .querySelectorAll(`${sel} [data-terminal-id][data-visible]`)
          .item(i) as HTMLElement | null;
        const xterm = tile?.querySelector(".xterm") as HTMLElement | null;
        if (!xterm) throw new Error(`xterm element in tile ${i + 1} not found`);
        const tag = `xterm-${Date.now()}-${Math.random()}`;
        xterm.setAttribute("data-stability-tag", tag);
        (
          window as unknown as { __xtermStabilityTag?: string }
        ).__xtermStabilityTag = tag;
      },
      { sel: CANVAS_SELECTOR, i: index - 1 },
    );
  },
);

Then("some canvas tile should be maximized", async function (this: KoluWorld) {
  const maximizedTile = this.page.locator(
    `${TILE_SELECTOR}[data-maximized="true"]`,
  );
  await maximizedTile
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the tagged xterm element should still exist in the DOM",
  async function (this: KoluWorld) {
    // The tag is unique per-test-run; finding any element with that
    // attribute proves the originally-tagged `.xterm` node is still
    // mounted. If the active-switch had remounted xterm.js (the #988
    // bug), the tagged node would have been disposed and this query
    // returns null — assertion fails as it would have pre-fix.
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
