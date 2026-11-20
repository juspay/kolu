/** Fresh-open steps — a browser tab that has never shown kolu before.
 *
 *  Where a tab lands is decided from what the tab has stored (the chrome tab
 *  lives in `sessionStorage`), so these steps open and reload the page and
 *  nothing more: no terminal is created on the way in, because an empty host
 *  is part of what a first open can find. A scenario that wants the tab
 *  truly fresh is tagged `@fresh-open`; without the tag the harness pre-seeds
 *  a touch page onto its host (see `support/hooks.ts`). */

import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

When(
  "I open kolu for the first time in this tab",
  async function (this: KoluWorld) {
    await this.page.goto("/");
    await this.waitForSettled();
  },
);

When("I reload the tab", async function (this: KoluWorld) {
  await this.page.reload();
  await this.waitForSettled();
});
