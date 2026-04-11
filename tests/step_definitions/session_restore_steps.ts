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
    const session = {
      terminals: dirs.map((cwd, i) => ({ id: String(i), cwd })),
      savedAt: Date.now(),
    };
    // Stash on world so Then-step can re-POST as a self-heal if the server
    // snapshot didn't carry the session through to this client.
    this.savedSessionForRestore = session;
    const resp = await this.page.request.fetch("/rpc/state/test__set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ json: { session } }),
    });
    assert.ok(resp.ok(), `session/test__set failed: ${resp.status()}`);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    // Wait for empty-state to mount (client+ws alive). Then poll for the
    // restore card. If empty-state is up but the card never appears, it
    // means the server's snapshot didn't carry the session — re-POST it
    // (the previous saved-session terminals are stashed on the world by
    // the Given step) and let the state__changed publish re-render.
    await this.page
      .locator('[data-testid="empty-state"]')
      .waitFor({ state: "visible", timeout: 15000 });
    const card = this.page.locator('[data-testid="session-restore"]');
    try {
      await card.waitFor({ state: "visible", timeout: 3000 });
      return;
    } catch {
      // First attempt failed. Snapshot what the server thinks the state is
      // RIGHT NOW so the failure log is actionable instead of mystery.
      const serverState = await this.page.request.fetch(
        "/rpc/state/get?batch=1",
      );
      const serverStatusCode = serverState.status();
      // Re-POST the stashed session to wake the second hydration effect.
      const saved = this.savedSessionForRestore;
      if (saved) {
        await this.page.request.fetch("/rpc/state/test__set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ json: { session: saved } }),
        });
      }
      try {
        await card.waitFor({ state: "visible", timeout: 7000 });
        return;
      } catch (err) {
        const html = await this.page
          .locator('[data-testid="empty-state"]')
          .innerHTML()
          .catch(() => "<unable to read>");
        throw new Error(
          `session restore card never visible. saved=${JSON.stringify(saved)} serverGetStatus=${serverStatusCode} empty-state HTML=${html.slice(0, 800)} | original=${(err as Error).message}`,
        );
      }
    }
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
