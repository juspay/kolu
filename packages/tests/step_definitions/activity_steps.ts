import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

/** Wait until terminal reaches expected activity state via waitForFunction. */
async function assertActivity(
  world: KoluWorld,
  index: number,
  expectActive: boolean,
  timeout = POLL_TIMEOUT,
): Promise<void> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const expectedAttr = expectActive ? "active" : "sleeping";
  await world.page.waitForFunction(
    ({ id, expected }) => {
      const entry = document.querySelector(
        `[data-testid="canvas-tile"][data-terminal-id="${id}"]`,
      );
      return entry?.getAttribute("data-activity") === expected;
    },
    { id, expected: expectedAttr },
    { timeout },
  );
}

Then("the terminal should show as active", async function (this: KoluWorld) {
  await assertActivity(this, this.createdTerminalIds.length, true);
});

Then("the terminal should show as sleeping", async function (this: KoluWorld) {
  await assertActivity(this, this.createdTerminalIds.length, false);
});

Then(
  "terminal {int} should show as active",
  async function (this: KoluWorld, index: number) {
    await assertActivity(this, index, true);
  },
);

Then(
  "terminal {int} should show as sleeping",
  async function (this: KoluWorld, index: number) {
    await assertActivity(this, index, false);
  },
);

Then("the activity graph should have data", async function (this: KoluWorld) {
  const index = this.createdTerminalIds.length;
  const id = this.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  await this.page.waitForFunction(
    (id) => {
      const graph = document.querySelector(
        `[data-testid="canvas-tile"][data-terminal-id="${id}"] [data-testid="activity-graph"]`,
      );
      return graph?.getAttribute("data-has-data") === "true";
    },
    id,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I wait for the terminal to become idle",
  async function (this: KoluWorld) {
    // The idle threshold is 5s, but shell init (starship, nix env, etc.) may
    // produce sporadic output that resets the timer. Under load from the full
    // test suite, init can take 10-15s. Wait up to 30s for safety.
    await assertActivity(this, this.createdTerminalIds.length, false, 30_000);
  },
);
