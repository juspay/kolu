import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const VIEW_SELECTOR = '[data-testid="mobile-tile-view"]';

Then(
  "the mobile tile view should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(VIEW_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

async function dispatchSwipe(
  world: KoluWorld,
  dx: number,
  selector = VIEW_SELECTOR,
) {
  const view = world.page.locator(selector);
  const box = await view.boundingBox();
  assert.ok(box, `Swipe target ${selector} has no bounding box`);
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Synthesize a touch sequence — Playwright's touchscreen.tap() doesn't
  // send the start/end pair MobileTileView listens for. Use a minimal
  // browser-side dispatch so the swipe handler sees real Touch events.
  // tsx/esbuild instruments closures with `__name` for stack-trace fidelity,
  // which doesn't exist in the browser. page.evaluate ships the function
  // body as a string — the workaround is to ship plain JS source via
  // page.evaluate(string) so esbuild never touches it.
  //
  // touchstart/touchend dispatch on `target` and bubble, so the gesture
  // originates from the chosen element. Pointing it at the key bar lets a
  // test assert the bar's stopPropagation guard keeps the wrapper from
  // cycling tiles when a finger drags across the keys.
  const src = `
    (() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) throw new Error("swipe target not found");
      const t = (x, y) => new Touch({
        identifier: 1, target, clientX: x, clientY: y,
        pageX: x, pageY: y, screenX: x, screenY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
      });
      target.dispatchEvent(new TouchEvent("touchstart", {
        cancelable: true, bubbles: true,
        touches: [t(${startX}, ${y})],
        targetTouches: [t(${startX}, ${y})],
        changedTouches: [t(${startX}, ${y})],
      }));
      target.dispatchEvent(new TouchEvent("touchend", {
        cancelable: true, bubbles: true,
        touches: [], targetTouches: [],
        changedTouches: [t(${startX + dx}, ${y})],
      }));
    })()
  `;
  await world.page.evaluate(src);
  await world.waitForFrame();
}

When("I swipe left on the mobile tile view", async function (this: KoluWorld) {
  await dispatchSwipe(this, -200);
});

When("I swipe right on the mobile tile view", async function (this: KoluWorld) {
  await dispatchSwipe(this, 200);
});

When("I swipe left on the mobile key bar", async function (this: KoluWorld) {
  await dispatchSwipe(this, -200, '[data-testid="mobile-key-bar"]');
});

// The active mobile tile is the one whose body is shown (`data-visible`).
// Capturing its terminal id before/after a gesture is renderer-independent —
// unlike reading xterm's canvas-backed `.xterm-screen` text — so it cleanly
// proves whether a swipe cycled the tile.
const ACTIVE_TILE = "[data-visible][data-terminal-id]";

When("I remember the active mobile terminal", async function (this: KoluWorld) {
  const id = await this.page
    .locator(ACTIVE_TILE)
    .first()
    .getAttribute("data-terminal-id");
  assert.ok(id, "No active mobile terminal to remember");
  this.savedActiveTerminalId = id;
});

Then(
  "the active mobile terminal should be unchanged",
  async function (this: KoluWorld) {
    const before = this.savedActiveTerminalId;
    assert.ok(
      before,
      "No remembered active terminal — call 'I remember the active mobile terminal' first",
    );
    const after = await this.page
      .locator(ACTIVE_TILE)
      .first()
      .getAttribute("data-terminal-id");
    assert.strictEqual(
      after,
      before,
      `Expected the active mobile terminal to stay ${before}, but it switched to ${after}`,
    );
  },
);

Then(
  "the active terminal should not show {string}",
  async function (this: KoluWorld, text: string) {
    // The .innerText() catch falls back to "" only when the locator can't
    // resolve (e.g. xterm hasn't mounted yet) — equivalent to "no buffer
    // exists, so it can't contain the text", which is what the assertion
    // expects. Any actual page error would fail elsewhere with a hard error.
    const seen = await this.page
      .locator("[data-visible] .xterm-screen")
      .innerText()
      .catch(() => "");
    assert.ok(
      !seen.includes(text),
      `Expected active terminal NOT to show "${text}" but found it.`,
    );
  },
);
