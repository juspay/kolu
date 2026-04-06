/**
 * Foreground process detection — step definitions.
 *
 * Verifies that the sidebar and header show the foreground process name,
 * driven by OSC 2 title changes from the shell preexec hook.
 */

import { Then } from "@cucumber/cucumber";
import * as assert from "node:assert";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";

/** Read the process name from the sidebar's data-testid="process-name" element. */
async function getSidebarProcessName(world: KoluWorld): Promise<string | null> {
  try {
    const el = world.page
      .locator('[data-testid="sidebar"]')
      .locator('[data-testid="process-name"]')
      .first();
    const text = await el.textContent({ timeout: 1000 });
    return text?.trim() ?? null;
  } catch {
    return null;
  }
}

Then(
  "the sidebar process name should be {string}",
  async function (this: KoluWorld, expected: string) {
    const name = await pollUntil(
      this.page,
      () => getSidebarProcessName(this),
      (n) => n === expected,
      { attempts: 30, intervalMs: 200 },
    );
    assert.strictEqual(
      name,
      expected,
      `Expected sidebar process name "${expected}", got "${name}"`,
    );
  },
);

Then(
  "the header should contain the text {string}",
  async function (this: KoluWorld, expected: string) {
    const headerText = await pollUntil(
      this.page,
      async () => {
        try {
          return (
            (await this.page
              .locator('[data-testid="header-cwd"]')
              .textContent({ timeout: 1000 })) ?? ""
          );
        } catch {
          return "";
        }
      },
      (t) => t.includes(expected),
      { attempts: 30, intervalMs: 200 },
    );
    assert.ok(
      headerText.includes(expected),
      `Expected header to contain "${expected}", got "${headerText}"`,
    );
  },
);
