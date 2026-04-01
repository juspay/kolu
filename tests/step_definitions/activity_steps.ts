import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import * as assert from "node:assert";

/** Check if the sidebar entry for a terminal (1-based index) shows active. */
async function getIndicatorActive(
  world: KoluWorld,
  index: number,
): Promise<boolean> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const entry = world.page.locator(
    `[data-testid="sidebar"] [data-terminal-id="${id}"]`,
  );
  const activity = await entry.getAttribute("data-activity");
  return activity === "active";
}

/** Poll until terminal reaches expected activity state, then assert. */
async function assertActivity(
  world: KoluWorld,
  index: number,
  expectActive: boolean,
  pollOpts?: { attempts: number; intervalMs: number },
): Promise<void> {
  const isActive = await pollUntil(
    world.page,
    () => getIndicatorActive(world, index),
    (val) => val === expectActive,
    pollOpts,
  );
  const label = expectActive ? "active" : "sleeping";
  assert.strictEqual(
    isActive,
    expectActive,
    `Expected terminal ${index} to be ${label}`,
  );
}

Then("the workspace should show as active", async function (this: KoluWorld) {
  await assertActivity(this, this.createdTerminalIds.length, true);
});

Then("the workspace should show as sleeping", async function (this: KoluWorld) {
  await assertActivity(this, this.createdTerminalIds.length, false);
});

Then(
  "workspace {int} should show as active",
  async function (this: KoluWorld, index: number) {
    await assertActivity(this, index, true);
  },
);

Then(
  "workspace {int} should show as sleeping",
  async function (this: KoluWorld, index: number) {
    await assertActivity(this, index, false);
  },
);

Then("the activity graph should have data", async function (this: KoluWorld) {
  const index = this.createdTerminalIds.length;
  const id = this.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const graph = this.page.locator(
    `[data-testid="sidebar"] [data-terminal-id="${id}"] [data-testid="activity-graph"]`,
  );
  const hasData = await pollUntil(
    this.page,
    async () => (await graph.getAttribute("data-has-data")) === "true",
    (val) => val === true,
    { attempts: 30, intervalMs: 200 },
  );
  assert.ok(hasData, "Expected activity graph to have data");
});

When(
  "I wait for the workspace to become idle",
  async function (this: KoluWorld) {
    // The idle threshold is 5s, but shell init (starship, nix env, etc.) may
    // produce sporadic output that resets the timer. Under load from the full
    // test suite, init can take 10-15s. Poll up to ~30s for safety.
    await assertActivity(this, this.createdTerminalIds.length, false, {
      attempts: 60,
      intervalMs: 500,
    });
  },
);
