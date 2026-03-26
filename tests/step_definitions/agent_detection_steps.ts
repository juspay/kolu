import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import * as assert from "node:assert";

/** Check if the agent label is visible for a terminal (by 1-based index). */
async function getAgentLabel(
  world: KoluWorld,
  index: number,
): Promise<string | null> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const label = world.page.locator(
    `[data-terminal-id="${id}"] [data-testid="agent-label"]`,
  );
  if ((await label.count()) === 0) return null;
  return label.textContent();
}

Then(
  "the sidebar should show agent {string}",
  async function (this: KoluWorld, expectedAgent: string) {
    const label = await pollUntil(
      this.page,
      () => getAgentLabel(this, this.createdTerminalIds.length),
      (val) => val !== null && val.includes(expectedAgent),
      { attempts: 30, intervalMs: 500 },
    );
    assert.ok(
      label && label.includes(expectedAgent),
      `Expected agent label containing "${expectedAgent}", got: ${label}`,
    );
  },
);

Then(
  "the sidebar should not show an agent label",
  async function (this: KoluWorld) {
    // Wait a moment for any potential agent detection, then check it's absent
    await this.page.waitForTimeout(2000);
    const label = await getAgentLabel(this, this.createdTerminalIds.length);
    assert.strictEqual(
      label,
      null,
      `Expected no agent label, but found: ${label}`,
    );
  },
);
