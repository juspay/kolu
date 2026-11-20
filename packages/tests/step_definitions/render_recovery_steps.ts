import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import {
  ACTIVE_TERMINAL,
  waitForBufferContains,
  waitForFirstScreen,
} from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

interface RenderProbeWindow {
  __paintCount: number;
  __syncRefreshes: number;
  __parkedRaf?: typeof window.requestAnimationFrame;
}

When(
  "I stall the focused terminal's render loop",
  async function (this: KoluWorld) {
    await waitForFirstScreen(this.page);
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const term = (
        el as unknown as {
          __xterm?: {
            onRender(cb: () => void): { dispose(): void };
            options?: { cursorBlink?: boolean };
            _core?: {
              _renderService?: {
                refreshRows?: (s: number, e: number, sync?: boolean) => void;
                _renderDebouncer?: { _animationFrame?: number };
              };
            };
          };
        }
      )?.__xterm;
      const rs = term?._core?._renderService;
      if (!term || !rs || typeof rs.refreshRows !== "function") {
        throw new Error("render service unavailable on focused terminal");
      }
      const w = window as unknown as RenderProbeWindow;
      w.__paintCount = 0;
      w.__syncRefreshes = 0;
      if (term.options) term.options.cursorBlink = false;
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: Boolean.bind(null, false),
      });
      term.onRender(() => {
        w.__paintCount++;
      });
      const origRefresh = rs.refreshRows.bind(rs);
      const anonymousRefreshRows = [
        (s: number, e: number, sync?: boolean) => {
          if (sync) w.__syncRefreshes++;
          origRefresh(s, e, sync);
        },
      ];
      rs.refreshRows = anonymousRefreshRows[0];
      const rd = rs._renderDebouncer;
      if (rd && rd._animationFrame !== undefined) {
        cancelAnimationFrame(rd._animationFrame);
        rd._animationFrame = undefined;
      }
      w.__parkedRaf = window.requestAnimationFrame;
      const anonymousParkedRaf = [
        ((_cb: FrameRequestCallback) =>
          0) as typeof window.requestAnimationFrame,
      ];
      window.requestAnimationFrame = anonymousParkedRaf[0];
    }, ACTIVE_TERMINAL);
  },
);

Then(
  "the latest output is in the buffer but the screen has not repainted",
  async function (this: KoluWorld) {
    await waitForBufferContains(this.page, "scroll-test-30");
    const paints = await this.page.evaluate(
      () => (window as unknown as RenderProbeWindow).__paintCount,
    );
    assert.strictEqual(
      paints,
      0,
      `expected no paints while the render loop was stalled, saw ${paints}`,
    );
  },
);

When("the window regains focus", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    const w = window as unknown as RenderProbeWindow;
    if (w.__parkedRaf) window.requestAnimationFrame = w.__parkedRaf;
    delete (document as unknown as { hasFocus?: unknown }).hasFocus;
    window.dispatchEvent(new FocusEvent("focus"));
  });
});

Then(
  "the terminal force-repaints to the latest output",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const w = window as unknown as RenderProbeWindow;
        return w.__syncRefreshes > 0 && w.__paintCount > 0;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
