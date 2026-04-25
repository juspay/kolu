import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("I click the activity alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="activity-alerts-toggle"]');
  await this.waitForFrame();
});

When("I simulate an activity alert", async function (this: KoluWorld) {
  // Use page.evaluate to call the simulate function directly,
  // avoiding command palette navigation complexity.
  await this.page.evaluate(() => {
    window.__koluSimulateAlert?.();
  });
  await this.waitForFrame();
});

When(
  "I simulate an activity alert for the active terminal",
  async function (this: KoluWorld) {
    await this.page.evaluate(() => {
      window.__koluSimulateAlert?.({ target: "active" });
    });
    await this.waitForFrame();
  },
);

When("I simulate the Kolu tab being hidden", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await this.waitForFrame();
});

When(
  "I simulate the Kolu tab becoming visible",
  async function (this: KoluWorld) {
    await this.page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await this.waitForFrame();
  },
);

Then("a pill tree branch should be notified", async function (this: KoluWorld) {
  const notified = this.page.locator(
    '[data-testid="pill-tree-branch"][data-unread]',
  );
  await notified.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "no pill tree branch should be notified",
  async function (this: KoluWorld) {
    // Double frame wait to flush SolidJS reactivity + any pending DOM updates
    await this.waitForFrame();
    await this.waitForFrame();
    const count = await this.page
      .locator('[data-testid="pill-tree-branch"][data-unread]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no notified entries, found ${count}`,
    );
  },
);

When("I click the notified pill tree branch", async function (this: KoluWorld) {
  const notified = this.page.locator(
    '[data-testid="pill-tree-branch"][data-unread]',
  );
  await notified.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await notified.first().click();
  await this.waitForFrame();
});

When("I stub the Badging API", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    window.__badgeCalls = [];
    navigator.setAppBadge = (count?: number) => {
      window.__badgeCalls?.push({ method: "set", count });
      return Promise.resolve();
    };
    navigator.clearAppBadge = () => {
      window.__badgeCalls?.push({ method: "clear" });
      return Promise.resolve();
    };
  });
});

Then(
  "the app badge should show {int}",
  async function (this: KoluWorld, expected: number) {
    await this.waitForFrame();
    const lastSet = await this.page.evaluate(() => {
      const calls = window.__badgeCalls ?? [];
      return calls
        .filter((c): c is { method: "set"; count?: number } => c.method === "set")
        .pop();
    });
    assert.ok(lastSet, "Expected setAppBadge to have been called");
    assert.strictEqual(lastSet.count, expected);
  },
);

Then("the app badge should be cleared", async function (this: KoluWorld) {
  await this.waitForFrame();
  const lastCall = await this.page.evaluate(() => {
    const calls = window.__badgeCalls ?? [];
    return calls[calls.length - 1];
  });
  assert.ok(lastCall, "Expected a badge API call");
  assert.strictEqual(lastCall.method, "clear");
});
