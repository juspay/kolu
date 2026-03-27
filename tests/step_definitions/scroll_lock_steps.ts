import { When, Then } from "@cucumber/cucumber";
import assert from "node:assert";
import { KoluWorld } from "../support/world.ts";

/** Locate the xterm viewport div inside the active terminal. */
function viewportLocator(world: KoluWorld) {
  return world.page.locator("[data-visible] .xterm-viewport");
}

When(
  "I generate {int} lines of output",
  async function (this: KoluWorld, count: number) {
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo scroll-test-$i; done`,
    );
    await this.page.waitForTimeout(1000);
  },
);

When(
  "I generate {int} more lines of output",
  async function (this: KoluWorld, count: number) {
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo extra-line-$i; done`,
    );
    await this.page.waitForTimeout(1000);
  },
);

When("I scroll the terminal up", async function (this: KoluWorld) {
  const viewport = viewportLocator(this);
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Viewport not visible");
  // Move mouse to viewport center and scroll up
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -500);
  await this.page.waitForTimeout(500);
});

When("I note the scroll position", async function (this: KoluWorld) {
  this.savedScrollTop = await viewportLocator(this).evaluate(
    (el) => el.scrollTop,
  );
});

When(
  "I schedule {int} lines of delayed output",
  async function (this: KoluWorld, count: number) {
    // Start a background job that outputs after a delay — lets us scroll up first
    await this.terminalRun(
      `(sleep 2; for i in $(seq 1 ${count}); do echo delayed-$i; done) &`,
    );
    await this.page.waitForTimeout(500);
  },
);

When("I wait for the delayed output", async function (this: KoluWorld) {
  await this.page.waitForTimeout(3000);
});

When("I click the scroll-to-bottom button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-to-bottom"]');
  await this.page.waitForTimeout(300);
});

When("I click the scroll lock toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-lock-toggle"]');
  await this.page.waitForTimeout(200);
});

Then(
  "the scroll-to-bottom button should be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the scroll-to-bottom button should be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator(
      '[data-testid="scroll-to-bottom"][data-active]',
    );
    await btn.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the scroll-to-bottom button should not be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: 3000 });
    const active = await btn.getAttribute("data-active");
    assert.strictEqual(active, null, "Expected button to not be active");
  },
);

Then(
  "the scroll-to-bottom button should not be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "hidden", timeout: 3000 });
  },
);

Then(
  "the scroll position should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedScrollTop !== undefined,
      "No saved scroll position — was 'I note the scroll position' called first?",
    );
    const current = await viewportLocator(this).evaluate((el) => el.scrollTop);
    // Allow small tolerance (1px) for rounding
    assert.ok(
      Math.abs(current - this.savedScrollTop!) <= 1,
      `Scroll position changed: was ${this.savedScrollTop}, now ${current}`,
    );
  },
);
