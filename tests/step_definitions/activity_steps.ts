import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import * as assert from "node:assert";

const ACTIVITY_INDICATOR = '[data-testid="activity-indicator"]';

/** Get the activity indicator color class for a terminal by scenario index (1-based). */
async function getIndicatorActive(
  world: KoluWorld,
  index: number,
): Promise<boolean> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const indicator = world.page.locator(
    `[data-terminal-id="${id}"] ${ACTIVITY_INDICATOR}`,
  );
  const classes = await indicator.getAttribute("class");
  return classes?.includes("bg-green-400") ?? false;
}

Then("the terminal should show as active", async function (this: KoluWorld) {
  const lastIdx = this.createdTerminalIds.length;
  const isActive = await pollUntil(
    this.page,
    () => getIndicatorActive(this, lastIdx),
    (val) => val === true,
  );
  assert.ok(isActive, "Expected terminal to show as active (green indicator)");
});

Then("the terminal should show as sleeping", async function (this: KoluWorld) {
  const lastIdx = this.createdTerminalIds.length;
  const isActive = await getIndicatorActive(this, lastIdx);
  assert.ok(
    !isActive,
    "Expected terminal to show as sleeping (grey indicator)",
  );
});

Then(
  "terminal {int} should show as active",
  async function (this: KoluWorld, index: number) {
    const isActive = await pollUntil(
      this.page,
      () => getIndicatorActive(this, index),
      (val) => val === true,
    );
    assert.ok(
      isActive,
      `Expected terminal ${index} to show as active (green indicator)`,
    );
  },
);

Then(
  "terminal {int} should show as sleeping",
  async function (this: KoluWorld, index: number) {
    const isActive = await getIndicatorActive(this, index);
    assert.ok(
      !isActive,
      `Expected terminal ${index} to show as sleeping (grey indicator)`,
    );
  },
);

When(
  "I wait for the terminal to become idle",
  async function (this: KoluWorld) {
    const lastIdx = this.createdTerminalIds.length;
    // Poll until the indicator turns grey (sleeping).
    // The idle threshold is 5 seconds, so wait up to ~10s.
    const isActive = await pollUntil(
      this.page,
      () => getIndicatorActive(this, lastIdx),
      (val) => val === false,
      { attempts: 20, intervalMs: 500 },
    );
    assert.ok(
      !isActive,
      "Terminal did not become idle within the expected time",
    );
  },
);
