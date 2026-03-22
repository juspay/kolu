import { Then } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

Then(
  "the header should show theme {string}",
  async function (this: KoluWorld, expectedTheme: string) {
    const header = this.page.locator("header");
    await header.waitFor({ state: "visible", timeout: 5_000 });
    // Poll for theme text to appear (may take a moment after palette action)
    let text = "";
    for (let i = 0; i < 10; i++) {
      text = (await header.textContent()) ?? "";
      if (text.includes(expectedTheme)) return;
      await this.page.waitForTimeout(300);
    }
    assert.ok(
      text.includes(expectedTheme),
      `Expected header to contain "${expectedTheme}" but got "${text}"`,
    );
  },
);
