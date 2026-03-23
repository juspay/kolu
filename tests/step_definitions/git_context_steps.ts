import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";
import { pollUntil } from "../support/poll.ts";

Then(
  "the header should show repo {string}",
  async function (this: KoluWorld, expected: string) {
    const el = this.page.locator('[data-testid="header-repo"]');
    const text = await pollUntil(
      this.page,
      async () => {
        try {
          return (await el.textContent({ timeout: 1000 })) ?? "";
        } catch {
          return "";
        }
      },
      (t) => t.includes(expected),
      { attempts: 20, intervalMs: 500 },
    );
    assert.ok(
      text.includes(expected),
      `Expected header repo to contain "${expected}" but got "${text}"`,
    );
  },
);

Then("the header should show a branch name", async function (this: KoluWorld) {
  const el = this.page.locator('[data-testid="header-branch"]');
  const text = await pollUntil(
    this.page,
    async () => {
      try {
        return (await el.textContent({ timeout: 1000 })) ?? "";
      } catch {
        return "";
      }
    },
    (t) => t.length > 0,
    { attempts: 20, intervalMs: 500 },
  );
  assert.ok(
    text.length > 0,
    `Expected header to show a branch name but got empty`,
  );
});

Then(
  "the header should not show git context",
  async function (this: KoluWorld) {
    const repoEl = this.page.locator('[data-testid="header-repo"]');
    const count = await repoEl.count();
    assert.strictEqual(
      count,
      0,
      `Expected no git context in header but found ${count} repo elements`,
    );
  },
);
