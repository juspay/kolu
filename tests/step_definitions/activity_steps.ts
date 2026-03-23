import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";
import * as assert from "node:assert";

/** Check if the activity indicator for a terminal (1-based index) shows green/active. */
async function getIndicatorActive(
  world: KoluWorld,
  index: number,
): Promise<boolean> {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index}`);
  const indicator = world.page.locator(
    `[data-terminal-id="${id}"] [data-testid="activity-indicator"]`,
  );
  const classes = await indicator.getAttribute("class");
  return classes?.includes("bg-green-400") ?? false;
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

When(
  "I wait for the terminal to become idle",
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
