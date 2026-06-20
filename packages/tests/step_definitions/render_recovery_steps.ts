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
  __stalled: boolean;
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
            _core?: {
              _renderService?: {
                refreshRows?: (s: number, e: number, sync?: boolean) => void;
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
      // PHASE flag: while stalled, swallow EVERY refresh so the screen cannot
      // repaint — `the window regains focus` flips it false so only the fix's
      // forced repaint after focus is allowed through and counted.
      w.__stalled = true;
      // NOTE on the `__name`-avoidance shapes below: esbuild's keep-names
      // transform decorates any NAME-INFERRED function (an arrow assigned to a
      // variable/property, or an object-literal value) with a `__name(...)`
      // call that doesn't exist in page.evaluate's browser context, so it
      // crashes (see file_drop_steps.ts). Call-argument arrows (the onRender
      // callback) are safe — no name is inferred — but a `value: () => …` and a
      // `rs.refreshRows = () => …` are not, so this uses a bound function and an
      // array element (neither name-inferred) instead.
      //
      // Model occlusion: the window is backgrounded, so `document.hasFocus()` is
      // false. The production watchdog (renderRecovery.noteData) only arms while
      // the document has focus, so forcing this false keeps it disarmed through
      // `I generate 30 lines of output` — otherwise, on a slow runner, output +
      // the buffer wait could exceed WATCHDOG_DELAY_MS (250ms) and the watchdog
      // would fire the sync repaint before the "not repainted yet" assertion
      // (paintCount > 0), flaking the test. `the window regains focus` restores
      // it before dispatching the focus event. `Boolean.bind(null, false)` is a
      // no-literal hasFocus()→false.
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: Boolean.bind(null, false),
      });
      term.onRender(() => {
        w.__paintCount++;
      });
      // Swallow the debounced/async refresh the way a parked rAF would (a frame
      // never serviced under occlusion), but let the forced SYNCHRONOUS refresh
      // — what the fix calls on window focus — through, and count it. The
      // wrapper lives as an array element so esbuild leaves it anonymous.
      const orig = rs.refreshRows.bind(rs);
      // While stalled, drop ALL refreshes — including the incidental FULL-RANGE
      // sync repaint that generating output triggers (refreshRows(0, rows-1,
      // true) on scroll). Range alone can't tell that apart from the fix's
      // forced repaint, which is exactly why a range filter still flaked. The
      // data still lands in xterm's buffer (refreshRows only paints), so the
      // buffer assertion holds while __paintCount stays 0. Once focus is regained
      // (__stalled=false), recover()'s forced sync repaint passes through and is
      // the only counted paint. Array element so esbuild leaves it anonymous.
      const swallow = [
        (s: number, e: number, sync?: boolean) => {
          if (w.__stalled) return;
          if (sync) {
            w.__syncRefreshes++;
            orig(s, e, true);
          }
        },
      ];
      rs.refreshRows = swallow[0];
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
    // Leave the stall phase BEFORE dispatching focus so recover()'s forced
    // repaint is allowed through the swallow (and counted).
    (window as unknown as RenderProbeWindow).__stalled = false;
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
