import * as assert from "node:assert";
import { Then } from "@cucumber/cucumber";
import { AGENTS_FIRST_RUN_TITLE } from "@kolu/agent-distro/status";
import type { KoluWorld } from "../support/world.ts";

Then("I see the welcome moments", async function (this: KoluWorld) {
  const moments = this.page.locator('[data-testid="welcome-moments"]');
  await moments.waitFor({ state: "visible" });
  const text = (await moments.textContent()) ?? "";
  // A fresh install (the suite's start): the first-run agents choice leads.
  for (const label of [
    AGENTS_FIRST_RUN_TITLE,
    "Pin it",
    "From another device",
  ]) {
    assert.ok(text.includes(label), `Welcome moments missing "${label}"`);
  }
});
