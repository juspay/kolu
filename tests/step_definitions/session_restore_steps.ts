import { Given, When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";
import * as assert from "node:assert";
import * as os from "node:os";

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Use paths guaranteed to exist on all platforms (no mkdir needed)
    const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
    const resp = await this.page.request.fetch("/rpc/state/test__set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        json: {
          session: {
            terminals: dirs.map((cwd, i) => ({ id: String(i), cwd })),
            savedAt: Date.now(),
          },
        },
      }),
    });
    assert.ok(resp.ok(), `session/test__set failed: ${resp.status()}`);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    // Under parallel-worker load, the initial app mount can race the
    // server's session-state propagation: the client fetches state before
    // the server has finished applying the test__set POST, sees an empty
    // session, and never re-renders the restore card. The 20s budget on
    // a single waitForFunction doesn't help — the state is "wrong" until
    // we re-fetch it.
    //
    // Self-healing fix: poll briefly, then page.reload() to force a fresh
    // state fetch. Reload is cheap (bundle is cached) and idempotent.
    const cardVisible = () =>
      this.page.evaluate(() => {
        const card = document.querySelector('[data-testid="session-restore"]');
        return !!(card && card.getBoundingClientRect().height > 0);
      });

    const pollFor = async (budgetMs: number) => {
      const start = Date.now();
      while (Date.now() - start < budgetMs) {
        if (await cardVisible()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    if (await pollFor(5000)) return;
    // Stalled — reload to re-fetch state and try again.
    await this.page.reload({ waitUntil: "load" });
    if (await pollFor(15000)) return;
    throw new Error(
      "session restore card never became visible (after initial poll + reload)",
    );
  },
);

Then(
  "the restore button should mention {string}",
  async function (this: KoluWorld, text: string) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const content = await btn.textContent();
    assert.ok(
      content?.includes(text),
      `Expected restore button to contain "${text}", got "${content}"`,
    );
  },
);

When("I click the restore button", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="restore-session"]');
  await btn.click();
  // Wait for at least one terminal to appear — under load from 8 parallel
  // workers, server can be slow to spawn terminals. Use waitForFunction
  // for a reactive DOM check instead of locator.waitFor.
  await this.page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    SIDEBAR_ENTRY_SELECTOR,
    { timeout: 20000 },
  );
});

Then(
  "there should be {int} sidebar entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: SIDEBAR_ENTRY_SELECTOR, count: expected },
      { timeout: 15000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} sidebar entries, got ${actual}`,
    );
  },
);
