/**
 * Foreground process detection — step definitions.
 *
 * Verifies that the sidebar and header show the foreground process name,
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
  "the sidebar process name should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const name = await pollUntil(
      this.page,
      () => getSidebarProcessName(this),
      (n) => n !== null && n.includes(expected),
      { attempts: 30, intervalMs: 200 },
    );
    assert.ok(
      name && name.includes(expected),
      `Expected sidebar process name to contain "${expected}", got "${name}"`,
    );
  },
);

Then(
  "the sidebar process name should be non-empty",
  async function (this: KoluWorld) {
    const name = await pollUntil(
      this.page,
      () => getSidebarProcessName(this),
      (n) => n !== null && n.length > 0,
      { attempts: 30, intervalMs: 200 },
    );
    assert.ok(
      name && name.length > 0,
      `Expected sidebar process name to be non-empty, got "${name}"`,
    );
  },
);

When(
  "I run a long-running {string} command",
  async function (this: KoluWorld, command: string) {
    // Type the command and press Enter. The command stays running so the
    // preexec-emitted OSC 2 title remains visible until the test asserts on it.
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
  },
);
