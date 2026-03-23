import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";
import { pollUntil } from "../support/poll.ts";

/** Poll a data-testid element until its text satisfies a predicate. */
async function pollTestId(
  world: KoluWorld,
  testId: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  const el = world.page.locator(`[data-testid="${testId}"]`);
  return pollUntil(
    world.page,
    async () => {
      try {
        return (await el.textContent({ timeout: 1000 })) ?? "";
      } catch {
        return "";
      }
    },
    predicate,
    { attempts: 20, intervalMs: 500 },
  );
}

Then("the header should show a branch name", async function (this: KoluWorld) {
  const text = await pollTestId(this, "header-branch", (t) => t.length > 0);
  assert.ok(text.length > 0, `Expected header to show a branch name`);
});

Then("the sidebar should show a branch name", async function (this: KoluWorld) {
  const text = await pollTestId(this, "sidebar-branch", (t) => t.length > 0);
  assert.ok(text.length > 0, `Expected sidebar to show a branch name`);
});

Then(
  "the header should not show git context",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="header-branch"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no git context in header but found ${count} branch elements`,
    );
  },
);

Then(
  "the sidebar should not show git context",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="sidebar-branch"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no git context in sidebar but found ${count} branch elements`,
    );
  },
);
