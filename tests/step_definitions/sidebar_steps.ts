import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I create a terminal", async function (this: KoluWorld) {
  const id = await this.createTerminal();
  this.createdTerminalIds.push(id);
});

When(
  "I select terminal {int} in the sidebar",
  async function (this: KoluWorld, index: number) {
    // Select by the Nth terminal created in this scenario (1-based)
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await this.page
      .locator(`[data-testid="sidebar"] [data-terminal-id="${id}"]`)
      .click();
    // Wait for the selected terminal to become active (data-visible attribute appears)
    await this.page
      .locator(`[data-terminal-id="${id}"][data-visible]`)
      .waitFor({ state: "attached", timeout: 5000 });
  },
);

Then(
  "the empty state tip should not be visible",
  async function (this: KoluWorld) {
    const tip = this.page.locator('[data-testid="empty-state"]');
    await tip.waitFor({ state: "hidden" });
  },
);

Given(
  "I note the sidebar entry count",
  async function (this: KoluWorld) {
    const buttons = this.page.locator('[data-testid="sidebar"] [data-terminal-id]');
    this.savedSidebarCount = await buttons.count();
  },
);

Then(
  "the sidebar should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedSidebarCount ?? 0) + delta;
    // Wait for entries to appear (onMount restores terminals asynchronously after refresh)
    const buttons = this.page.locator('[data-testid="sidebar"] [data-terminal-id]');
    await buttons.nth(expected - 1).waitFor({ state: "visible", timeout: 5000 });
    const current = await buttons.count();
    const baseline = this.savedSidebarCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new sidebar entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

Then(
  "the active terminal should show {string}",
  async function (this: KoluWorld, expected: string) {
    // Get the active terminal's ID from the visible data-terminal-id element
    const activeContainer = this.page.locator("[data-visible][data-terminal-id]");
    const terminalId = await activeContainer.getAttribute("data-terminal-id");
    assert.ok(terminalId, "No active terminal found");

    // Poll screen state until expected content appears (echo may still be in-flight)
    let screenState = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const resp = await this.page.request.fetch("/rpc/terminal/screenState", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ json: { id: terminalId } }),
      });
      const body = await resp.json();
      screenState = typeof body.json === "string" ? body.json : JSON.stringify(body);
      if (screenState.includes(expected)) return;
      await this.page.waitForTimeout(300);
    }
    assert.fail(
      `Active terminal screen does not contain "${expected}" after retries.\nScreen state (partial): ${screenState.slice(0, 500)}`,
    );
  },
);
