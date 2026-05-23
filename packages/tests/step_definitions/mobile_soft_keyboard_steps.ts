import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Browser-side window augmentation used by the focus-shuffle detection probe. */
type FocusProbeWindow = Window & { __screenFocusCount?: number };

const KEY_BAR = '[data-testid="mobile-key-bar"]';
const KEY = (testId: string) => `[data-testid="mobile-key-${testId}"]`;

When(
  "I tap the mobile key {string}",
  async function (this: KoluWorld, testId: string) {
    await this.page.locator(KEY(testId)).tap();
    // Each tap fires `client.terminal.sendInput` which is fire-and-forget at
    // the call site. Yield a frame so the WebSocket frame leaves before the
    // next step runs — keeps multi-key sequences ordered.
    await this.waitForFrame();
  },
);

Then(
  "the mobile soft key bar should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(KEY_BAR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I tap the terminal canvas", async function (this: KoluWorld) {
  // Install a focus-event observer on .xterm-screen BEFORE the tap so we can
  // detect the iOS-style contenteditable auto-focus. The bug surfaces when the
  // browser focuses the contenteditable on pointerdown and our wrapper-click
  // handler then shuffles to the helper textarea — the smoking gun is a focus
  // event landing on .xterm-screen during the gesture.
  await this.page.evaluate(() => {
    const screen = document.querySelector(
      "[data-visible][data-terminal-id] .xterm-screen",
    ) as HTMLElement | null;
    if (!screen) throw new Error("No .xterm-screen on active terminal");
    const w = window as FocusProbeWindow;
    w.__screenFocusCount = 0;
    screen.addEventListener("focus", () => {
      w.__screenFocusCount = (w.__screenFocusCount ?? 0) + 1;
    });
  });

  // Real CDP touch via Playwright's touchscreen triggers the browser's native
  // contenteditable auto-focus heuristic — synthetic dispatchEvent doesn't.
  const canvas = this.page
    .locator("[data-visible][data-terminal-id] .xterm-screen canvas")
    .first();
  const box = await canvas.boundingBox();
  assert.ok(box, "xterm canvas has no bounding box");
  await this.page.touchscreen.tap(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await this.waitForFrame();
});

Then(
  "the xterm contenteditable screen should never have been focused",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate(
      () => (window as FocusProbeWindow).__screenFocusCount ?? 0,
    );
    assert.strictEqual(
      count,
      0,
      `Expected .xterm-screen to never receive focus during the tap (focus-shuffle indicator), got ${count} focus events`,
    );
  },
);

Then(
  "xterm's helper textarea should be the active element",
  async function (this: KoluWorld) {
    // Poll until focus settles — touchscreen tap focus assignment may not be
    // synchronous by the time this step runs (mirrors the pattern used in
    // terminal_lifecycle_steps.ts for "[data-focused]" after dialog dismissal).
    await this.page.waitForFunction(
      () =>
        document.activeElement?.tagName === "TEXTAREA" &&
        document.activeElement.classList.contains("xterm-helper-textarea"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active terminal should show {string} {int} time(s)",
  async function (this: KoluWorld, expected: string, count: number) {
    // Poll the buffer for at-least-N occurrences. Used to verify history
    // recall + Enter — after run, the buffer holds the typed line + output;
    // after recall + submit, both pairs appear, so the marker count grows
    // from 2 to 4. Asserting >= N tolerates extra renders.
    await this.page.waitForFunction(
      ([sel, exp, n]) => {
        const buf = window.__readXtermBuffer?.(sel, 0) ?? "";
        let occurrences = 0;
        let idx = 0;
        while ((idx = buf.indexOf(exp, idx)) !== -1) {
          occurrences++;
          idx += exp.length;
        }
        return occurrences >= n;
      },
      [ACTIVE_TERMINAL, expected, count] as const,
      { timeout: POLL_TIMEOUT },
    );
  },
);
