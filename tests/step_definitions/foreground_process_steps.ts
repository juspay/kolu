/**
 * Foreground process detection — step definitions.
 *
 * Verifies that the sidebar shows the exact foreground process name,
 * driven by OSC 2 title changes from the shell preexec hook.
 */

import { Then, When } from "@cucumber/cucumber";
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

When(
  "I run a long-running {string} command",
  async function (this: KoluWorld, command: string) {
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    // Brief pause to let the shell preexec fire and the command start
    await new Promise((r) => setTimeout(r, 500));
  },
);
