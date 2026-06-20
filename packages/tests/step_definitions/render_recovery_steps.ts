import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, waitForBufferContains } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Window globals this scenario installs on the focused terminal to observe
 *  the paint pipeline: paint count (xterm `onRender` firings) and the number
 *  of FORCED synchronous repaints (the fix's `refreshRows(_, _, true)`). */
interface RenderProbeWindow {
  __paintCount: number;
  __syncRefreshes: number;
  /** The page's real requestAnimationFrame, stashed while it's parked to model
   *  an occluded window's frozen paint loop; restored on focus regain. */
  __origRaf?: typeof window.requestAnimationFrame;
}

When(
  "I stall the focused terminal's render loop",
  async function (this: KoluWorld) {
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
      // Disable cursor blink — its periodic repaint would bump __paintCount on
      // its own, independent of output rendering.
      if (term.options) term.options.cursorBlink = false;
      // Model occlusion: the window is backgrounded, so `document.hasFocus()` is
      // false. The production watchdog (renderRecovery.noteData) only arms while
      // the document has focus, so forcing this false keeps it disarmed through
      // `I generate 30 lines of output`. `the window regains focus` restores it.
      // `Boolean.bind(null, false)` is a no-literal hasFocus()→false.
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: Boolean.bind(null, false),
      });
      term.onRender(() => {
        w.__paintCount++;
      });
      // Count the FORCED sync repaint the fix issues on focus (recover ->
      // refreshRows(_, _, true)); pass every refresh through unchanged. The
      // wrapper is an array element so esbuild's keep-names leaves it anonymous —
      // a NAME-INFERRED `rs.refreshRows = () => …` gets a `__name(...)` call that
      // doesn't exist in page.evaluate and crashes (see file_drop_steps.ts).
      const origRefresh = rs.refreshRows.bind(rs);
      const wrap = [
        (s: number, e: number, sync?: boolean) => {
          if (sync) w.__syncRefreshes++;
          origRefresh(s, e, sync);
        },
      ];
      rs.refreshRows = wrap[0];
      // Model the occlusion freeze the way it ACTUALLY happens (renderRecovery.ts):
      // xterm funnels every async paint through ONE requestAnimationFrame with no
      // timer fallback, so an occluded window — whose rAFs are never serviced —
      // accumulates buffer writes with ZERO onRender firings. Cancel any in-flight
      // render frame, then PARK rAF so no async paint can fire: __paintCount stays
      // 0 airtight (a refreshRows swallow missed the debounced/in-flight render
      // and flaked). The forced SYNC refreshRows on focus bypasses rAF and still
      // repaints. The array element keeps the replacement anonymous for esbuild.
      // NOTE: subsequent steps that wait on buffer CONTENT (`I generate 30 lines
      // of output`, `the latest output is in the buffer …`) go through
      // `waitForBufferContains`, which polls on a timer — NOT on rAF — so parking
      // the page's rAF here cannot deadlock those waits. xterm writes PTY data
      // into its buffer synchronously; only the paint is rAF-gated.
      const rd = rs._renderDebouncer;
      if (rd && rd._animationFrame !== undefined) {
        cancelAnimationFrame(rd._animationFrame);
        rd._animationFrame = undefined;
      }
      w.__origRaf = window.requestAnimationFrame;
      const park = [
        ((_cb: FrameRequestCallback) =>
          0) as typeof window.requestAnimationFrame,
      ];
      window.requestAnimationFrame = park[0];
    }, ACTIVE_TERMINAL);
  },
);

Then(
  "the latest output is in the buffer but the screen has not repainted",
  async function (this: KoluWorld) {
    // Data reached xterm's buffer (this is the bug: it's all there) ...
    await waitForBufferContains(this.page, "scroll-test-30");
    // ... yet no paint happened while the render loop was stalled.
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
  // App-switch return fires `focus` (not `visibilitychange`); the fix's
  // window-focus listener turns it into a forced synchronous repaint.
  // Restore real focus reporting first (the stall step forced hasFocus()=false
  // to model occlusion), then dispatch the focus event the listener keys off.
  await this.page.evaluate(() => {
    // Resume frame production (the window is visible again) BEFORE dispatching
    // focus, so the fix's recover() runs against a live rAF.
    const w = window as unknown as RenderProbeWindow;
    if (w.__origRaf) window.requestAnimationFrame = w.__origRaf;
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
