import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import * as assert from "node:assert";

Then(
  "the sidebar should show a foreground process",
  async function (this: KoluWorld) {
    const id = this.createdTerminalIds[this.createdTerminalIds.length - 1];
    assert.ok(id, "No terminal created");
    const label = this.page.locator(
      `[data-terminal-id="${id}"] [data-testid="fg-process"]`,
    );
    // Poll until the foreground process label appears (may take a moment after idle)
    const text = await pollUntil(
      this.page,
      () => label.textContent(),
      (val) => val !== null && val.length > 0,
      { attempts: 20, intervalMs: 500 },
    );
    assert.ok(
      text && text.length > 0,
      `Expected foreground process label, got: ${text}`,
    );
  },
);

Then(
  "the sidebar should not show an agent label",
  async function (this: KoluWorld) {
    await this.page.waitForTimeout(2000);
    const id = this.createdTerminalIds[this.createdTerminalIds.length - 1];
    assert.ok(id, "No terminal created");
    const label = this.page.locator(
      `[data-terminal-id="${id}"] [data-testid="agent-label"]`,
    );
    const count = await label.count();
    assert.strictEqual(count, 0, `Expected no agent label, but found one`);
  },
);
