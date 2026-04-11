import { Given, When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";
import * as assert from "node:assert";
import * as os from "node:os";

/** Post the saved-session payload to the server. Used both at scenario
 *  setup (Given) and as a self-heal in the assertion. Idempotent. */
async function postSavedSession(
  page: KoluWorld["page"],
  count: number,
): Promise<void> {
  const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
  const resp = await page.request.fetch("/rpc/state/test__set", {
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
}

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Stash count for the assertion-side self-heal.
    this.savedSessionTerminalCount = count;
    await postSavedSession(this.page, count);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    // The flake we're working around: useSessionRestore.ts has a once-only
    // `hydrated` flag that gates `setSavedSession(state.session)` on the
    // first non-undefined value of the state subscription. Under
    // parallel-worker contention, the subscription occasionally hydrates
    // BEFORE the server's snapshot reflects our test__set POST — savedSession
    // gets set to null and the card never appears.
    //
    // The companion createEffect (gated on terminals.length===0 + hydrated)
    // re-runs whenever `serverState.savedSession()` changes, so re-POSTing
    // the session AFTER hydration drives the card into view via that path.
    //
    // Strategy:
    //   1. Wait for empty-state to mount (proves WS is up + hydrated has run).
    //   2. Re-POST the session — guaranteed to be processed AFTER hydration.
    //   3. Wait for the card with the remaining budget.
    await this.page
      .locator('[data-testid="empty-state"]')
      .waitFor({ state: "visible", timeout: 15000 });
    const card = this.page.locator('[data-testid="session-restore"]');
    // Fast path: card already visible (happy-hydration run). `.catch(() => false)`
    // because Playwright's isVisible() can throw on transient DOM states during
    // mount — treating those as "not visible" just routes to the self-heal below.
    if (await card.isVisible().catch(() => false)) return;
    if (this.savedSessionTerminalCount !== undefined) {
      await postSavedSession(this.page, this.savedSessionTerminalCount);
    }
    await card.waitFor({ state: "visible", timeout: 10000 });
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
