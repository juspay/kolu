import { Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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
