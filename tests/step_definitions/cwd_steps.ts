import { Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";
import { pollUntil } from "../support/poll.ts";

Then(
  "the header CWD should show {string}",
  async function (this: KoluWorld, expected: string) {
    const cwdEl = this.page.locator('[data-testid="header-cwd"]');
    const text = await pollUntil(
      this.page,
      async () => {
        try {
          return (await cwdEl.textContent({ timeout: 1000 })) ?? "";
        } catch {
          return "";
        }
      },
      (t) => t.includes(expected),
      { attempts: 20, intervalMs: 500 },
    );
    assert.ok(
      text.includes(expected),
      `Expected header CWD to contain "${expected}" but got "${text}"`,
    );
  },
);
