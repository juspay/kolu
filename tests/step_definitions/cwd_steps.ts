import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

Then(
  "the header CWD should show {string}",
  async function (this: KoluWorld, expected: string) {
    const cwdEl = this.page.locator('[data-testid="header-cwd"]');
    let text = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      await this.page.waitForTimeout(500);
      try {
        text = (await cwdEl.textContent({ timeout: 1000 })) ?? "";
      } catch {
        text = "";
      }
      if (text.includes(expected)) return;
    }
    assert.fail(
      `Expected header CWD to contain "${expected}" but got "${text}" after retries`,
    );
  },
);
