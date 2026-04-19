/**
 * Foreground process detection — step definitions.
 *
 * Verifies that the pill tree and header show the foreground process name,
 * driven by OSC 2 title changes from the shell preexec hook.
 */

import { Then, When } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then(
  "the pill tree process name should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const el = document.querySelector(
          '[data-testid="canvas-tile"] [data-testid="process-name"]',
        );
        const text = el?.textContent?.trim() ?? "";
        return text.includes(exp);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the pill tree process name should be non-empty",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="canvas-tile"] [data-testid="process-name"]',
        );
        return (el?.textContent?.trim() ?? "").length > 0;
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I run a long-running {string} command",
  async function (this: KoluWorld, command: string) {
    // Type the command and press Enter. The command stays running so the
    // preexec-emitted OSC 2 title remains visible until the test asserts on it.
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  },
);
