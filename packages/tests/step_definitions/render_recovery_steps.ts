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
}

When(
  "I stall the focused terminal's render loop",
  async function (this: KoluWorld) {
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const term = (
        el as unknown as {
          __xterm?: {
            rows: number;
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
      // Swallow EVERY refresh while stalled — including incidental SYNC paints
      // from cursor blink / selection rendering that focusing + typing the
      // generate-output command triggers (narrow-range refreshRows(cursorRow,
      // cursorRow, true)). Those are unrelated to the occlusion repaint and, if
      // let through, fire onRender and bump __paintCount before the "not
      // repainted yet" assertion — flaking it on slower darwin runners. Only the
      // fix's FORCED repaint — recover() -> refreshRows(0, rows - 1, true), a
      // full-range sync call — is the signal this scenario verifies, so only
      // that one passes through and counts. Lives as an array element so
      // esbuild's keep-names leaves it anonymous (see the __name note above).
      const swallow = [
        (s: number, e: number, sync?: boolean) => {
          if (sync && s === 0 && e >= term.rows - 1) {
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
