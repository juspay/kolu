import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then(
  "a toast should appear with text {string}",
  async function (this: KoluWorld, expected: string) {
    // solid-sonner renders toasts as <li> inside an <ol> with data-sonner-toaster
    const toast = this.page.locator(`[data-sonner-toaster] li`).filter({
      hasText: expected,
    });
    await toast.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the clipboard should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => navigator.clipboard.readText().then((t) => t.includes(exp)),
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the clipboard should not contain {string}",
  async function (this: KoluWorld, unexpected: string) {
    await this.page.waitForFunction(
      (unexp) => navigator.clipboard.readText().then((t) => !t.includes(unexp)),
      unexpected,
      { timeout: POLL_TIMEOUT },
    );
  },
);
