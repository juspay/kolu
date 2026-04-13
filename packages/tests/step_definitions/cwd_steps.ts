import { Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then(
  "the header CWD should show {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const el = document.querySelector('[data-testid="inspector-cwd"]');
        return (el?.textContent ?? "").includes(exp);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);
