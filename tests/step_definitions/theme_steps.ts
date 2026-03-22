import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I reload the page", async function (this: KoluWorld) {
  await this.page.reload();
});

When("I wait for the terminal to be ready", async function (this: KoluWorld) {
  await this.waitForReady();
});

Then(
  "the terminal background should be {string}",
  async function (this: KoluWorld, expected: string) {
    // The terminal area container uses inline style background-color from the theme
    const container = this.page.locator(".rounded.border.border-slate-700");
    await container.waitFor({ state: "visible", timeout: 5000 });
    const bg = await container.evaluate((el) => el.style.backgroundColor);
    // Browser returns rgb() — convert expected hex to rgb for comparison
    const hex = expected.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const expectedRgb = `rgb(${r}, ${g}, ${b})`;
    assert.strictEqual(
      bg,
      expectedRgb,
      `Expected background ${expectedRgb}, got ${bg}`,
    );
  },
);
