import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

const VIEW_SELECTOR = '[data-testid="mobile-tile-view"]';

Then(
  "the mobile tile view should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(VIEW_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

async function dispatchSwipe(world: KoluWorld, dx: number) {
  const view = world.page.locator(VIEW_SELECTOR);
  const box = await view.boundingBox();
  assert.ok(box, "Mobile tile view has no bounding box");
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Synthesize a touch sequence — Playwright's touchscreen.tap() doesn't
  // send the start/end pair MobileTileView listens for. Use a minimal
  // browser-side dispatch so the swipe handler sees real Touch events.
  await world.page.evaluate(
    ({ x0, x1, y, sel }) => {
      const target = document.querySelector(sel) as HTMLElement | null;
      if (!target) throw new Error("mobile tile view not found");
      function makeTouch(x: number, y: number): Touch {
        return new Touch({
          identifier: 1,
          target,
          clientX: x,
          clientY: y,
          pageX: x,
          pageY: y,
          screenX: x,
          screenY: y,
          radiusX: 1,
          radiusY: 1,
          rotationAngle: 0,
          force: 1,
        });
      }
      const start = new TouchEvent("touchstart", {
        cancelable: true,
        bubbles: true,
        touches: [makeTouch(x0, y)],
        targetTouches: [makeTouch(x0, y)],
        changedTouches: [makeTouch(x0, y)],
      });
      const end = new TouchEvent("touchend", {
        cancelable: true,
        bubbles: true,
        touches: [],
        targetTouches: [],
        changedTouches: [makeTouch(x1, y)],
      });
      target.dispatchEvent(start);
      target.dispatchEvent(end);
    },
    { x0: startX, x1: startX + dx, y, sel: VIEW_SELECTOR },
  );
  await world.waitForFrame();
}

When("I swipe left on the mobile tile view", async function (this: KoluWorld) {
  await dispatchSwipe(this, -200);
});

When("I swipe right on the mobile tile view", async function (this: KoluWorld) {
  await dispatchSwipe(this, 200);
});

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
