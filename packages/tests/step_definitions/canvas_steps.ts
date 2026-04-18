import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const MINIMAP_SELECTOR = '[data-testid="canvas-minimap"]';
const MINIMAP_MAP_SELECTOR = '[data-testid="minimap-map"]';
const MINIMAP_TOGGLE_SELECTOR = '[data-testid="minimap-toggle"]';
const MINIMAP_VIEWPORT_RECT_SELECTOR = '[data-testid="minimap-viewport-rect"]';
const TILE_SELECTOR = '[data-testid="canvas-tile"]';
const TILE_TITLEBAR_SELECTOR = '[data-testid="canvas-tile-titlebar"]';

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
  (this as any).__zoomBefore = before;
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
    const before = (this as any).__zoomBefore as number | undefined;
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

Then(
  "the newest canvas tile should be centered in the viewport",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        const container = document.querySelector(sel);
        if (!container) return false;
        const tiles = container.querySelectorAll(
          "[data-terminal-id][data-visible]",
        );
        if (tiles.length < 2) return false;
        const tile = tiles[tiles.length - 1] as HTMLElement;
        const cRect = container.getBoundingClientRect();
        const tRect = tile.getBoundingClientRect();
        // Tile center vs container center — allow tolerance for grid snapping
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
      CANVAS_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
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

// ── Gesture ownership: two-finger scroll on terminal must not pan the canvas ──

/** Read the inner canvas div's transform (scale(z) translate(x, y)). Stable
 *  string identity is enough to prove pan/zoom did or didn't change. */
async function readCanvasTransform(world: KoluWorld): Promise<string> {
  return await world.page.evaluate((sel: string) => {
    const container = document.querySelector(sel);
    const inner = container?.firstElementChild as HTMLElement | null;
    return inner?.style.transform ?? "";
  }, CANVAS_SELECTOR);
}

When("I record the canvas transform", async function (this: KoluWorld) {
  (this as unknown as { __canvasTransform?: string }).__canvasTransform =
    await readCanvasTransform(this);
});

When(
  "I scroll the wheel over the terminal tile",
  async function (this: KoluWorld) {
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
    // Install a one-shot probe on the xterm element before dispatching. Canvas
    // owns the gesture from the previous background scroll; stopPropagation at
    // the canvas's capture-phase listener should prevent this event from ever
    // reaching the xterm probe.
    await this.page.evaluate(() => {
      const xterm = document.querySelector(
        "[data-visible] .xterm-screen",
      ) as HTMLElement | null;
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

// ── Shift-to-pan modifier ──

When(
  "I Shift+scroll the wheel over the terminal tile",
  async function (this: KoluWorld) {
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
      ({ sel, prev }: { sel: string; prev: string }) => {
        const container = document.querySelector(sel);
        const inner = container?.firstElementChild as HTMLElement | null;
        return inner !== null && inner.style.transform !== prev;
      },
      { sel: CANVAS_SELECTOR, prev: before ?? "" },
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

Then(
  "the minimap toggle button should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) !== null,
      MINIMAP_TOGGLE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the minimap map should be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) !== null,
    MINIMAP_MAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then("the minimap map should not be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (sel: string) => document.querySelector(sel) === null,
    MINIMAP_MAP_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When("I click the minimap toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator(MINIMAP_TOGGLE_SELECTOR);
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
  await this.waitForFrame();
});

When("I save the canvas viewport state", async function (this: KoluWorld) {
  const state = await this.page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      zoom: el.getAttribute("data-zoom"),
      transform: (el.firstElementChild as HTMLElement)?.style.transform,
    };
  }, CANVAS_SELECTOR);
  (this as any).__savedViewportState = state;
});

When("I drag the minimap viewport rect", async function (this: KoluWorld) {
  const rect = this.page.locator(MINIMAP_VIEWPORT_RECT_SELECTOR);
  await rect.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const box = await rect.boundingBox();
  if (!box) throw new Error("Viewport rect not visible");
  // Drag from center of viewport rect 30px to the right
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await this.page.mouse.move(cx, cy);
  await this.page.mouse.down();
  await this.page.mouse.move(cx + 30, cy, { steps: 5 });
  await this.page.mouse.up();
  await this.waitForFrame();
});

Then(
  "the canvas viewport state should have changed",
  async function (this: KoluWorld) {
    const saved = (this as any).__savedViewportState as {
      zoom: string | null;
      transform: string | null;
    } | null;
    await this.page.waitForFunction(
      ({ sel, prev }: { sel: string; prev: { transform: string | null } }) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const transform = (el.firstElementChild as HTMLElement)?.style
          .transform;
        return transform !== prev.transform;
      },
      { sel: CANVAS_SELECTOR, prev: { transform: saved?.transform ?? null } },
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

Then(
  "the focused canvas tile should use the webgl renderer",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => {
        // The active tile is rendered inside a CanvasTile wrapper that flags
        // itself via data-active="true" (see CanvasTile.tsx).
        const active = document.querySelector(`${sel} [data-active="true"]`);
        if (!active) return false;
        const terminal = active.querySelector("[data-terminal-id]");
        return terminal?.getAttribute("data-renderer") === "webgl";
      },
      CANVAS_SELECTOR,
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
        // CanvasTile wrapper. The wrapper also carries `data-terminal-id`
        // via the terminal rendered inside it, but keyed by tile order in
        // the canvas container.
        const wrappers = document.querySelectorAll(
          `${sel} > div > [data-terminal-id][data-visible]`,
        );
        // That won't match — the wrapper (CanvasTile) and terminal are
        // separate elements. Use the tile-rect index instead: find all
        // CanvasTile wrappers and check the nth one.
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
  const result = await world.page.evaluate((sel: string) => {
    const container = document.querySelector(sel);
    const inner = container?.querySelector(
      "[data-terminal-id][data-visible]",
    ) as HTMLElement | null;
    if (!inner) return null;
    const id = inner.getAttribute("data-terminal-id");
    const tile = inner.closest("[style*='left']") as HTMLElement | null;
    if (!tile || !id) return null;
    return {
      id,
      left: parseFloat(tile.style.left),
      top: parseFloat(tile.style.top),
    };
  }, CANVAS_SELECTOR);
  if (!result) throw new Error("No visible canvas tile found");
  return result;
}

When(
  "I move the canvas tile to x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const { id } = await readFirstTilePosition(this);
    const layout = { x, y, w: 700, h: 500 };
    const resp = await this.page.request.fetch(
      "/rpc/terminal/setCanvasLayout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ json: { id, layout } }),
      },
    );
    assert.ok(resp.ok(), `terminal/setCanvasLayout failed: ${resp.status()}`);
    // Wait for the tile to render at the new position — proves the metadata
    // subscription delivered the update (the mechanism that must survive refresh).
    await this.page.waitForFunction(
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

// ── Tile maximize ──

When(
  "I double-click the title bar of canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const titleBar = this.page
      .locator(`${CANVAS_SELECTOR} ${TILE_TITLEBAR_SELECTOR}`)
      .nth(index - 1);
    await titleBar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // `dblclick` waits for the element to be "stable" and visible at the
    // viewport center of the bounding box. The first tile's title bar
    // overlaps spatially with the floating PillTree (top center of the
    // canvas), and Playwright's hit-test rejects the click target — even
    // with the pill tree at z-0. `force: true` bypasses the hit-test
    // (we know the title bar is the intended target; the pill tree is
    // visually behind it per #622's z-order spec).
    await titleBar.dblclick({ force: true });
    await this.waitForFrame();
  },
);

Then(
  "canvas tile {int} should be maximized",
  async function (this: KoluWorld, index: number) {
    const tile = this.page.locator(TILE_SELECTOR).nth(index - 1);
    await tile.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      (sel: string) => {
        const tiles = document.querySelectorAll(sel);
        return [...tiles].some(
          (t) => t.getAttribute("data-maximized") === "true",
        );
      },
      TILE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
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
