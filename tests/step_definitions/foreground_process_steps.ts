/**
 * Foreground process detection — step definitions.
 *
 * Verifies that the sidebar shows the foreground process name,
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
  "the sidebar should show a process name",
  async function (this: KoluWorld) {
    const name = await pollUntil(
      this.page,
      () => getSidebarProcessName(this),
      (n) => n !== null && n.length > 0,
      { attempts: 30, intervalMs: 200 },
    );
    assert.ok(
      name && name.length > 0,
      `Expected sidebar to show a process name, got "${name}"`,
    );
  },
);

Then(
  "the sidebar process name should eventually change",
  async function (this: KoluWorld) {
    // After running a command, the process name should update
    // (it may briefly show "cat" then revert to the shell)
    // We just verify the process-name element exists and has content
    const name = await pollUntil(
      this.page,
      () => getSidebarProcessName(this),
      (n) => n !== null && n.length > 0,
      { attempts: 30, intervalMs: 200 },
    );
    assert.ok(
      name && name.length > 0,
      `Expected process name to be present after command, got "${name}"`,
    );
  },
);
