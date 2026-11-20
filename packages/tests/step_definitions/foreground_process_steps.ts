import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then(
  "the workspace switcher process name should contain {string}",
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
  "the workspace switcher process name should be non-empty",
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
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  },
);
