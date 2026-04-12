import { Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

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
    const text = await this.page.evaluate(() => navigator.clipboard.readText());
    assert.ok(
      text.includes(expected),
      `Expected clipboard to contain "${expected}" but got: ${text.slice(0, 200)}`,
    );
  },
);

Then(
  "the clipboard should not contain {string}",
  async function (this: KoluWorld, unexpected: string) {
    const text = await this.page.evaluate(() => navigator.clipboard.readText());
    assert.ok(
      !text.includes(unexpected),
      `Expected clipboard NOT to contain "${unexpected}" but it does`,
    );
  },
);
