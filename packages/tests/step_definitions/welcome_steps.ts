import { Then } from "@cucumber/cucumber";
import { AGENTS_FIRST_RUN_TITLE } from "@kolu/agent-distro/status";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

Then("I see the welcome moments", async function (this: KoluWorld) {
  const moments = this.page.locator('[data-testid="welcome-moments"]');
  await moments.waitFor({ state: "visible" });
  // A fresh install (the suite's start): the first-run agents choice leads.
  // Polled per label — the agents row lands once preferences and the listing do.
  for (const label of [
    AGENTS_FIRST_RUN_TITLE,
    "Pin it",
    "From another device",
  ]) {
    await moments
      .getByText(label, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  }
});
