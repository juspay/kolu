/**
 * Steps for padi's section of the Diagnostic info dialog — the answer of
 * `diagnostics.read`, fetched when the dialog opens.
 */

import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SECTION = '[data-testid="padi-diagnostics"]';

Then(
  "the padi diagnostics show a child process row and a watcher row",
  async function (this: KoluWorld) {
    const section = this.page.locator(SECTION);
    await section.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The terminal's git sensor holds a watch on its cwd, and padi samples
    // its own memory through osfacts every few seconds — so both tables have
    // a row on any live padi. A fetch error would name itself instead.
    const error = section.locator('[data-testid="padi-diagnostics-error"]');
    const childRow = section.locator(
      '[data-testid="padi-diagnostics-child-row"]',
    );
    const watcherRow = section.locator(
      '[data-testid="padi-diagnostics-watcher-row"]',
    );
    await childRow
      .or(error)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    if (await error.isVisible()) {
      throw new Error(
        `padi diagnostics failed to load: ${await error.textContent()}`,
      );
    }
    await watcherRow
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
