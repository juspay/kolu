import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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
