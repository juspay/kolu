import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// Wait for the server state subscription to deliver at least one value.
// After page reload, the singleton preferences store starts with defaults;
// the server push that reconciles persisted values arrives slightly later.
When("I wait for server state sync", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    () =>
      document
        .querySelector("[data-ws-status]")
        ?.getAttribute("data-ws-status") === "open",
    { timeout: POLL_TIMEOUT },
  );
  await this.waitForFrame();
  await this.waitForFrame();
});

// ── Actions ──

When("I click the right panel pin toggle", async function (this: KoluWorld) {
  // The pin button in the right panel tab bar — matches "Pin panel" or "Unpin panel"
  const btn = this.page.locator(
    '[data-testid="right-panel"] button[aria-label="Unpin panel"], [data-testid="right-panel"] button[aria-label="Pin panel"]',
  );
  await btn.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.first().click();
  await this.waitForFrame();
});

When("I click the right panel backdrop", async function (this: KoluWorld) {
  const backdrop = this.page.locator('[data-testid="right-panel-backdrop"]');
  await backdrop.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await backdrop.click();
  await this.waitForFrame();
});

// ── Assertions ──

Then(
  "the right panel pin button should show pinned",
  async function (this: KoluWorld) {
    // When panel is pinned, button offers to "Unpin"
    await this.page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="right-panel"]');
        if (!panel) return false;
        return !!panel.querySelector('button[aria-label="Unpin panel"]');
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel pin button should show unpinned",
  async function (this: KoluWorld) {
    // When panel is unpinned, button offers to "Pin"
    await this.page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="right-panel"]');
        if (!panel) return false;
        return !!panel.querySelector('button[aria-label="Pin panel"]');
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel pin button should eventually show unpinned",
  async function (this: KoluWorld) {
    // After reload, server state sync may take a moment. The pin button's
    // aria-label transitions from "Unpin panel" (default pinned=true) to
    // "Pin panel" once the subscription delivers the persisted pinned=false.
    await this.page.waitForFunction(
      () => {
        const panel = document.querySelector('[data-testid="right-panel"]');
        if (!panel) return false;
        return !!panel.querySelector('button[aria-label="Pin panel"]');
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);
