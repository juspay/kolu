import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

Then("the PWA install bar should be visible", async function (this: KoluWorld) {
  const bar = this.page.locator('[data-testid="pwa-install-bar"]');
  await bar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the PWA install bar should not be visible",
  async function (this: KoluWorld) {
    const bar = this.page.locator('[data-testid="pwa-install-bar"]');
    await bar.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

When("I dismiss the PWA install bar", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="pwa-install-dismiss"]').click();
});

Given(
  "the browser fires beforeinstallprompt",
  async function (this: KoluWorld) {
    // Chromium in Playwright doesn't fire beforeinstallprompt automatically,
    // so we synthesize a minimal event that the component can stash and later
    // call .prompt() on. A window-level flag records that .prompt() was called.
    await this.page.evaluate(() => {
      interface BipWindow extends Window {
        __bipPromptCalled?: boolean;
      }
      const w = window as BipWindow;
      w.__bipPromptCalled = false;
      const evt = new Event("beforeinstallprompt") as Event & {
        prompt?: () => Promise<void>;
        userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
      };
      evt.prompt = () => {
        w.__bipPromptCalled = true;
        return Promise.resolve();
      };
      evt.userChoice = Promise.resolve({ outcome: "accepted" as const });
      window.dispatchEvent(evt);
    });
  },
);

Then(
  "the PWA install button should be visible",
  async function (this: KoluWorld) {
    const button = this.page.locator('[data-testid="pwa-install-button"]');
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click the PWA install button", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="pwa-install-button"]').click();
});

Then(
  "the browser install prompt should have been invoked",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        (window as Window & { __bipPromptCalled?: boolean })
          .__bipPromptCalled === true,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
    const called = await this.page.evaluate(
      () =>
        (window as Window & { __bipPromptCalled?: boolean }).__bipPromptCalled,
    );
    assert.strictEqual(
      called,
      true,
      "expected event.prompt() to have been called",
    );
  },
);
