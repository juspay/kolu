import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollUntil } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("I click the attention alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="attention-alerts-toggle"]');
  await this.waitForFrame();
});

When("I simulate an attention alert", async function (this: KoluWorld) {
  // Use page.evaluate to call the simulate function directly,
  // avoiding command palette navigation complexity.
  await this.page.evaluate(() => {
    window.__koluSimulateAlert?.();
  });
  await this.waitForFrame();
});

When(
  "I simulate an attention alert for the active terminal",
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

Then(
  "a workspace switcher branch should be notified",
  async function (this: KoluWorld) {
    const notified = this.page.locator('[data-testid="dock-row"][data-unread]');
    await notified.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "no workspace switcher branch should be notified",
  async function (this: KoluWorld) {
    // Double frame wait to flush SolidJS reactivity + any pending DOM updates
    await this.waitForFrame();
    await this.waitForFrame();
    const count = await this.page
      .locator('[data-testid="dock-row"][data-unread]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no notified entries, found ${count}`,
    );
  },
);

When(
  "I click the notified workspace switcher branch",
  async function (this: KoluWorld) {
    const notified = this.page.locator('[data-testid="dock-row"][data-unread]');
    await notified.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await notified.first().click();
    await this.waitForFrame();
  },
);

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
    // POLL: the badge is now the cross-host `urgency` (awaiting-agent) count — a
    // WIRE fact that lands after the agent-state round-trips through padi's fold
    // and the client's watcher, so a single-read assert races the propagation.
    // Wait for the last `set` call to reach the expected count.
    const lastSet = await pollUntil(
      this.page,
      () =>
        this.page.evaluate(() => {
          const calls = window.__badgeCalls ?? [];
          return (
            calls
              .filter(
                (c): c is { method: "set"; count?: number } =>
                  c.method === "set",
              )
              .pop() ?? null
          );
        }),
      (s) => s?.count === expected,
      { attempts: 40, intervalMs: 250 },
    );
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

/** THE QUIET CLAIM, and the reason it is spelled as "never": the badge is
 *  de-duplicated against the last count it confirmed, so an agent that raises
 *  nothing produces NO call at all — there is no `clear` to find and "the last
 *  call was a clear" would fail on a perfectly quiet app. What a presence
 *  promises is that no count was ever put on the icon for it, which is exactly
 *  the absence of a `set` with a number in it. */
Then(
  "the app badge should never have counted an agent",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const counted = await this.page.evaluate(() =>
      (window.__badgeCalls ?? [])
        .filter(
          (call): call is { method: "set"; count?: number } =>
            call.method === "set" && (call.count ?? 0) > 0,
        )
        .map((call) => call.count),
    );
    assert.deepStrictEqual(
      counted,
      [],
      `the app badge was raised to ${counted.join(", ")} for an agent that needs nobody`,
    );
  },
);

/** The host tab's two attention marks, both absent: the working STRIPE along
 *  its bottom edge and the count segment beside its name. Scoped under
 *  `host-chip-row` — the hidden measuring twin also matches `host-chip` — and
 *  read off the ACTIVE tab, the one whose terminals the scenario is about. */
Then(
  "the active host tab should show no attention marks",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const marks = await this.page.evaluate(() => {
      const tab = document.querySelector(
        '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active]',
      );
      if (tab === null) return "no active host tab";
      const found = [
        tab.querySelector('[data-testid="host-tab-working-stripe"]') === null
          ? null
          : "working stripe",
        tab.querySelector('[data-testid="attention-active"]') === null
          ? null
          : "active count",
        tab.querySelector('[data-testid="attention-awaiting"]') === null
          ? null
          : "awaiting count",
      ].filter((mark) => mark !== null);
      return found.join(", ");
    });
    assert.strictEqual(
      marks,
      "",
      `the active host tab carried ${marks} for an agent that needs nobody`,
    );
  },
);
