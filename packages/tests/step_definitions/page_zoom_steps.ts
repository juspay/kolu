/** Page MAGNIFICATION steps — the browser's own zoom (`visualViewport.scale`),
 *  which is a different axis from the canvas's zoom (`data-zoom`) and from a
 *  terminal's font zoom.
 *
 *  Chrome delivers a trackpad pinch to a page as a `wheel` event carrying
 *  `ctrlKey: true`, so a pinch is synthesized over CDP rather than by
 *  dispatching an event object: `Input.synthesizePinchGesture` goes through
 *  the browser's real input pipeline, which is the only way the browser's own
 *  magnify-the-page path can run at all (a `dispatchEvent`-built WheelEvent is
 *  untrusted and never magnifies, so it could not catch #2354).
 *
 *  `gestureSourceType: "mouse"` is deliberate: the `"touch"` source emits raw
 *  touch points that neither kolu nor Chrome's desktop page-zoom path listens
 *  to, and measurably moved nothing. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { readPerTerminal } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const DOCK_SELECTOR = '[data-testid="dock"]';
const MAXIMIZED_TILE_SELECTOR =
  '[data-testid="canvas-tile"][data-maximized="true"]';
const APP_ROOT_SELECTOR = '[data-testid="app-root"]';
const PREVIEW_IFRAME_SELECTOR = '[data-testid="browse-preview-iframe"]';

/** How far a synthesized pinch spreads — matches the ~1.3 scale a real
 *  two-finger spread over the dock produced on master. */
const PINCH_SCALE = 1.3;

/** Let an input gesture or a forced scale change land: the browser's own
 *  magnification, the `visualViewport` resize event it fires, and whatever
 *  the app does in response (a `--app-h` write, an xterm refit) all cross
 *  process boundaries, so a bare rAF is too early to read. */
async function settle(world: KoluWorld) {
  await world.waitForFrame();
  await world.page.waitForTimeout(200);
  await world.waitForFrame();
}

async function pinchOver(world: KoluWorld, selector: string) {
  const box = await world.page.locator(selector).first().boundingBox();
  assert.ok(box, `No element to pinch over: ${selector}`);
  const cdp = await world.page.context().newCDPSession(world.page);
  try {
    await cdp.send("Input.synthesizePinchGesture", {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      scaleFactor: PINCH_SCALE,
      gestureSourceType: "mouse",
    });
  } finally {
    await cdp.detach();
  }
  await settle(world);
}

When("I pinch over the dock", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await pinchOver(this, DOCK_SELECTOR);
});

When("I pinch over the maximized tile", async function (this: KoluWorld) {
  await this.page
    .locator(MAXIMIZED_TILE_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await pinchOver(this, MAXIMIZED_TILE_SELECTOR);
});

/** A sandboxed preview frame gets the wheel event itself — the parent window
 *  never sees it — so this is the pinch that proves the in-iframe guard.
 *
 *  A visible `<iframe>` is not a booted SDK: the guard is installed by the
 *  injected script's `boot()`, which is still loading for a moment after the
 *  frame paints. `boot()` plants `#kolu-artifact-sdk-style` on its first line
 *  and attaches the guard a few lines later in the same tick, so that element
 *  is the proof the guard is in place — without it the pinch can land first
 *  and the scenario fails on a product that is fine. */
When("I pinch over the file preview iframe", async function (this: KoluWorld) {
  await this.page
    .locator(PREVIEW_IFRAME_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await this.page
    .frameLocator(PREVIEW_IFRAME_SELECTOR)
    .locator("#kolu-artifact-sdk-style")
    .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  await pinchOver(this, PREVIEW_IFRAME_SELECTOR);
});

Then("the page should not be magnified", async function (this: KoluWorld) {
  const scale = await this.page.evaluate(
    () => window.visualViewport?.scale ?? 1,
  );
  assert.ok(
    Math.abs(scale - 1) < 0.01,
    `the browser magnified the page to ${scale}× — a pinch anywhere in kolu must leave the page at 1×`,
  );
});

When("I record the canvas zoom level", async function (this: KoluWorld) {
  this.zoomBefore = await this.page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return Number.parseFloat(el?.getAttribute("data-zoom") ?? "1");
  }, CANVAS_SELECTOR);
});

Then(
  "the canvas zoom level should not have changed",
  async function (this: KoluWorld) {
    const before = this.zoomBefore;
    assert.ok(
      before !== undefined,
      "No canvas zoom recorded — call 'I record the canvas zoom level' first",
    );
    const after = await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return Number.parseFloat(el?.getAttribute("data-zoom") ?? "1");
    }, CANVAS_SELECTOR);
    assert.ok(
      Math.abs(after - before) < 0.001,
      `the hidden canvas zoomed from ${before} to ${after} — a pinch over a maximized tile must leave the canvas it covers alone`,
    );
  },
);

/** Force magnification the way a browser would after a pinch it handled
 *  itself — the state the app has to survive, independent of which gesture
 *  reached that state. */
When(
  "I force page magnification to {float}",
  async function (this: KoluWorld, factor: number) {
    const cdp = await this.page.context().newCDPSession(this.page);
    try {
      await cdp.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: factor,
      });
    } finally {
      await cdp.detach();
    }
    // Poll, don't sleep: the scale lands when the compositor says so, and a
    // loaded box can take longer than any fixed settle. (The "should not"
    // assertions keep the fixed settle — there is nothing to poll for there.)
    await this.page
      .waitForFunction(
        (want: number) =>
          Math.abs((window.visualViewport?.scale ?? 1) - want) < 0.01,
        factor,
        { timeout: POLL_TIMEOUT },
      )
      .catch(async () => {
        const scale = await this.page.evaluate(
          () => window.visualViewport?.scale ?? 1,
        );
        assert.fail(
          `page magnification never took: asked for ${factor}×, the page reports ${scale}×`,
        );
      });
    // The app reacts to the scale change (a `--app-h` write, an xterm refit)
    // one frame later; let that land before the assertions read it.
    await settle(this);
  },
);

Then("the app root should fill the window", async function (this: KoluWorld) {
  const seen = await this.page.evaluate((sel: string) => {
    const root = document.querySelector(sel);
    return {
      height: root ? Math.round(root.getBoundingClientRect().height) : null,
      windowHeight: window.innerHeight,
      appH: getComputedStyle(document.documentElement).getPropertyValue(
        "--app-h",
      ),
    };
  }, APP_ROOT_SELECTOR);
  assert.ok(seen.height !== null, "No app root found");
  assert.ok(
    Math.abs(seen.height - seen.windowHeight) <= 1,
    `the app is ${seen.height}px tall in a ${seen.windowHeight}px window (--app-h is ${seen.appH.trim() || "unset"}) — magnifying the page must not shrink the shell`,
  );
});

When("I snapshot the terminal grid", async function (this: KoluWorld) {
  const [cols, rows] = await Promise.all([
    readPerTerminal(this.page, "cols"),
    readPerTerminal(this.page, "rows"),
  ]);
  const grid: Record<string, { cols: number; rows: number }> = {};
  for (const [id, c] of Object.entries(cols)) {
    const r = rows[id];
    if (r !== undefined) grid[id] = { cols: c, rows: r };
  }
  assert.ok(
    Object.keys(grid).length >= 1,
    "No live terminal grid to snapshot — is any xterm mounted?",
  );
  this.savedTerminalGrid = grid;
});

Then(
  "the terminal grid should match its snapshot",
  async function (this: KoluWorld) {
    const before = this.savedTerminalGrid;
    assert.ok(
      before,
      "No grid snapshot — call 'I snapshot the terminal grid' first",
    );
    const [cols, rows] = await Promise.all([
      readPerTerminal(this.page, "cols"),
      readPerTerminal(this.page, "rows"),
    ]);
    for (const [id, grid] of Object.entries(before)) {
      assert.deepStrictEqual(
        { cols: cols[id], rows: rows[id] },
        grid,
        `terminal ${id} refit from ${grid.cols}×${grid.rows} to ${cols[id]}×${rows[id]} — magnifying the page must not resize the shell underneath it`,
      );
    }
  },
);
