import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

async function readViewportY(world: KoluWorld): Promise<number> {
  return world.page.evaluate(() => {
    const container = document.querySelector(
      "[data-visible][data-terminal-id]",
    ) as
      | (HTMLElement & {
          __xterm?: { buffer: { active: { viewportY: number } } };
        })
      | null;
    const y = container?.__xterm?.buffer.active.viewportY;
    if (y === undefined) throw new Error("xterm not found on active terminal");
    return y;
  });
}

When(
  "I note the terminal viewport scroll position",
  async function (this: KoluWorld) {
    await waitForBufferContains(this.page, "200");
    await this.page.waitForFunction(
      () => {
        const term = (
          document.querySelector("[data-visible][data-terminal-id]") as
            | (HTMLElement & {
                __xterm?: {
                  buffer: { active: { baseY: number; viewportY: number } };
                };
              })
            | null
        )?.__xterm;
        if (!term) return false;
        const buf = term.buffer.active;
        return buf.baseY > 0 && buf.baseY <= buf.viewportY;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
    this.savedScrollTop = await readViewportY(this);
  },
);

When(
  "I swipe down inside the terminal viewport",
  async function (this: KoluWorld) {
    // Dispatch a synthetic touchstart/touchmove/touchend on the terminal
    // container. Playwright's touchscreen.tap() only does single taps, and
    // hasTouch context doesn't translate mouse drags to touch — synthetic
    // TouchEvent dispatch is the most reliable path for swipe gestures.
    const container = this.page.locator("[data-visible][data-terminal-id]");
    const box = await container.boundingBox();
    assert.ok(box, "Terminal container has no bounding box");
    const x = box.x + box.width / 2;
    const startY = box.y + 20;
    const endY = box.y + box.height - 20;

    // NOTE: no nested function declarations inside page.evaluate.
    // swc wraps named functions with a `__name` debug helper that
    // doesn't exist in the browser context (other step files in this
    // repo follow the same single-level arrow pattern). The Y values
    // for each event are pre-computed in this Node-side scope and
    // passed across as a plain array.
    const steps = 8;
    const ys: number[] = [];
    for (let i = 1; i <= steps; i++) {
      ys.push(startY + ((endY - startY) * i) / steps);
    }
    await this.page.evaluate(
      ({ sel, x, startY, endY, ys }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (!target) throw new Error(`No element matches ${sel}`);
        const startTouch = new Touch({
          identifier: 0,
          target,
          clientX: x,
          clientY: startY,
        });
        target.dispatchEvent(
          new TouchEvent("touchstart", {
            touches: [startTouch],
            targetTouches: [startTouch],
            changedTouches: [startTouch],
            bubbles: true,
            cancelable: true,
          }),
        );
        for (const y of ys) {
          const t = new Touch({
            identifier: 0,
            target,
            clientX: x,
            clientY: y,
          });
          target.dispatchEvent(
            new TouchEvent("touchmove", {
              touches: [t],
              targetTouches: [t],
              changedTouches: [t],
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        const endTouch = new Touch({
          identifier: 0,
          target,
          clientX: x,
          clientY: endY,
        });
        target.dispatchEvent(
          new TouchEvent("touchend", {
            touches: [],
            targetTouches: [],
            changedTouches: [endTouch],
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { sel: "[data-visible][data-terminal-id]", x, startY, endY, ys },
    );
    await this.waitForFrame();
  },
);

Then(
  "the terminal viewport scroll position should have decreased",
  async function (this: KoluWorld) {
    const before = this.savedScrollTop;
    assert.ok(before !== undefined, "No scroll position was noted earlier");
    let after = before;
    for (let i = 0; i < 20; i++) {
      after = await readViewportY(this);
      if (after < before) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(
      `Expected viewportY to decrease from ${before}, but it stayed at ${after} after ${POLL_TIMEOUT}ms`,
    );
  },
);
