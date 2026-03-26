import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

Then(
  "the sidebar resize handle should be visible",
  async function (this: KoluWorld) {
    const handle = this.page.locator('[aria-label="Resize sidebar"]');
    const visible = await handle.isVisible();
    assert.ok(visible, "Expected sidebar resize handle to be visible");
  },
);

Given("I note the sidebar width", async function (this: KoluWorld) {
  const sidebar = this.page.locator('[data-testid="sidebar"]');
  const box = await sidebar.boundingBox();
  assert.ok(box, "Sidebar has no bounding box");
  this.savedSidebarWidth = box.width;
});

When(
  "I drag the sidebar resize handle {int} pixels to the right",
  async function (this: KoluWorld, pixels: number) {
    const handle = this.page.locator('[aria-label="Resize sidebar"]');
    const box = await handle.boundingBox();
    assert.ok(box, "Resize handle has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + pixels, y, { steps: 10 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(300);
  },
);

Then(
  "the sidebar should be wider than before",
  async function (this: KoluWorld) {
    const sidebar = this.page.locator('[data-testid="sidebar"]');
    const box = await sidebar.boundingBox();
    assert.ok(box, "Sidebar has no bounding box");
    assert.ok(
      this.savedSidebarWidth !== undefined,
      "No saved sidebar width — did you forget 'I note the sidebar width'?",
    );
    assert.ok(
      box.width > this.savedSidebarWidth!,
      `Expected sidebar to be wider (was ${this.savedSidebarWidth}, now ${box.width})`,
    );
  },
);

When("I click the sidebar toggle", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="sidebar-toggle"]').click();
  // Wait for CSS transition to settle
  await this.page.waitForTimeout(300);
});

When("I click the sidebar backdrop", async function (this: KoluWorld) {
  const backdrop = this.page.locator('[data-testid="sidebar-backdrop"]');
  // Click right side of backdrop (past the w-48 sidebar) to avoid hitting sidebar panel
  const box = await backdrop.boundingBox();
  assert.ok(box, "Backdrop has no bounding box");
  await backdrop.click({ position: { x: box.width - 10, y: box.height / 2 } });
  await this.page.waitForTimeout(300);
});

Then("the sidebar should be visible", async function (this: KoluWorld) {
  const sidebar = this.page.locator('[data-testid="sidebar"]');
  await sidebar.waitFor({ state: "attached" });
  const visible = await sidebar.isVisible();
  assert.ok(visible, "Expected sidebar to be visible");
});

Then("the sidebar should not be visible", async function (this: KoluWorld) {
  const sidebar = this.page.locator('[data-testid="sidebar"]');
  // Wait for CSS transition (200ms) to complete
  await this.page.waitForTimeout(300);
  // On desktop closed: display:none (no bounding box).
  // On mobile closed: translated off-screen (box.x + box.width <= 0).
  const box = await sidebar.boundingBox();
  if (box) {
    assert.ok(
      box.x + box.width <= 0,
      `Expected sidebar to be off-screen or hidden, but it's at x=${box.x}`,
    );
  }
});

Then(
  "the sidebar backdrop should be visible",
  async function (this: KoluWorld) {
    const backdrop = this.page.locator('[data-testid="sidebar-backdrop"]');
    const visible = await backdrop.isVisible();
    assert.ok(visible, "Expected sidebar backdrop to be visible on mobile");
  },
);

Then(
  "the sidebar should be below the header",
  async function (this: KoluWorld) {
    const header = this.page.locator("header");
    const sidebar = this.page.locator('[data-testid="sidebar"]');

    const headerBox = await header.boundingBox();
    const sidebarBox = await sidebar.boundingBox();
    assert.ok(headerBox, "Header has no bounding box");
    assert.ok(sidebarBox, "Sidebar has no bounding box");

    assert.ok(
      sidebarBox.y >= headerBox.y + headerBox.height,
      `Sidebar top (${sidebarBox.y}) overlaps header bottom (${headerBox.y + headerBox.height})`,
    );
  },
);
