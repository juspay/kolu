import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor, pollUntil } from "../support/poll.ts";
import { redeployUnderThisPage } from "../support/redeploy.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When(
  "the kolu server is redeployed under this page",
  { timeout: 180_000 },
  async function (this: KoluWorld) {
    await redeployUnderThisPage(this);
  },
);

Then(
  "the agent's dock row should show its finished turn",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '[data-testid="dock-row"][data-agent-state="waiting"] [data-testid="state-pip"]',
            ),
          ].map(
            (pip) =>
              `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`,
          ),
        ),
      isDone: (pips) => pips.includes("linger/none"),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (pips, ms) =>
        new Error(
          `after ${ms}ms no waiting agent's row showed a finished turn (pips: ${JSON.stringify(pips)})`,
        ),
    });
  },
);

Then("the agent's dock row should be unread", async function (this: KoluWorld) {
  await this.page
    .locator(
      '[data-testid="dock-row"][data-agent-state="waiting"][data-unread]',
    )
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the agent's dock row should show it asking",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="dock-row"][data-asking]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click the attention alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="attention-alerts-toggle"]');
  await this.waitForFrame();
});

When("I simulate an attention alert", async function (this: KoluWorld) {
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

When(
  /^I simulate the Kolu window (losing|regaining) focus$/,
  async function (this: KoluWorld, how: string) {
    await this.page.evaluate((focused) => {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: Boolean.bind(null, focused),
      });
    }, how === "regaining");
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

const stubBadge = (): void => {
  window.__badgeCalls = [];
  navigator.setAppBadge = (count?: number) => {
    window.__badgeCalls?.push({ method: "set", count });
    return Promise.resolve();
  };
  navigator.clearAppBadge = () => {
    window.__badgeCalls?.push({ method: "clear" });
    return Promise.resolve();
  };
};

When("I stub the Badging API", async function (this: KoluWorld) {
  await this.page.addInitScript(stubBadge);
  await this.page.evaluate(stubBadge);
});

const stubSound = (): void => {
  window.__soundPlays = [];
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    window.__soundPlays?.push(this.src ? new URL(this.src).pathname : "");
    return Promise.resolve();
  };
};

When("I stub the notification sound", async function (this: KoluWorld) {
  await this.page.addInitScript(stubSound);
  await this.page.evaluate(stubSound);
});

Then(
  "the notification sound should have played {int} time(s)",
  async function (this: KoluWorld, expected: number) {
    const read = () => this.page.evaluate(() => window.__soundPlays ?? []);
    await pollFor({
      observe: read,
      isDone: (plays) => plays.length >= expected,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (plays, elapsedMs) =>
        new Error(
          `after ${elapsedMs}ms the notification sound had played ${JSON.stringify(plays)}, wanted ${expected} time(s)`,
        ),
    });
    await this.waitForFrame();
    await this.waitForFrame();
    const plays = await read();
    assert.deepStrictEqual(
      plays,
      Array(expected).fill("/sounds/notification.mp3"),
      `the notification sound played ${JSON.stringify(plays)}, wanted ${expected} time(s)`,
    );
  },
);

Then(
  "the app badge should show {int}",
  async function (this: KoluWorld, expected: number) {
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
