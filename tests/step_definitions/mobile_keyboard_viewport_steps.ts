import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

const ROOT = '[data-testid="app-root"]';

/** Read the inline `height` style from the app root, parsed to a number. */
async function readRootHeight(world: KoluWorld): Promise<number> {
  return world.page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error("app-root element not found");
    const h = el.style.height;
    if (!h.endsWith("px")) throw new Error("root height is not in px: " + h);
    return parseFloat(h);
  }, ROOT);
}

Then(
  "the app root height should match the visual viewport height",
  async function (this: KoluWorld) {
    // Poll — visualViewport resize propagation through SolidJS is async.
    let actual = -1;
    let expected = -1;
    for (let i = 0; i < 20; i++) {
      const pair = await this.page.evaluate(() => ({
        vv: window.visualViewport?.height ?? window.innerHeight,
        rootStyle: (
          document.querySelector(
            '[data-testid="app-root"]',
          ) as HTMLElement | null
        )?.style.height,
      }));
      expected = pair.vv;
      actual = pair.rootStyle ? parseFloat(pair.rootStyle) : -1;
      if (actual === expected) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(
      `Expected app-root height to equal visualViewport.height (${expected}), got ${actual} after ${POLL_TIMEOUT}ms`,
    );
  },
);

When(
  "the visual viewport shrinks by {int} pixels",
  async function (this: KoluWorld, delta: number) {
    // Simulate the soft keyboard opening by overriding visualViewport.height
    // and dispatching a synthetic `resize` event. Playwright's headless
    // Chromium has no real soft keyboard, so this is the only path.
    // Note: all declarations must be top-level statements inside evaluate
    // (no nested function declarations — they trip swc's `__name` helper
    // which is undefined in the page context; see mobile_terminal_scroll_steps.ts).
    await this.page.evaluate((d) => {
      const vv = window.visualViewport;
      if (!vv) throw new Error("window.visualViewport not available");
      const current = vv.height;
      // Override height via Object.defineProperty — visualViewport.height
      // is a getter, so `vv.height = ...` would be a no-op.
      Object.defineProperty(vv, "height", {
        configurable: true,
        get() {
          return current - d;
        },
      });
      vv.dispatchEvent(new Event("resize"));
    }, delta);
    await this.waitForFrame();
  },
);
