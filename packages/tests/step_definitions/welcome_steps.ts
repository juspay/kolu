import * as assert from "node:assert";
import { Then } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

Then("I see the welcome moments", async function (this: KoluWorld) {
  const moments = this.page.locator('[data-testid="welcome-moments"]');
  await moments.waitFor({ state: "visible" });
  const text = (await moments.textContent()) ?? "";
  for (const label of ["Pin it", "Reach it anywhere", "Run agents"]) {
    assert.ok(text.includes(label), `Welcome moments missing "${label}"`);
  }
});
