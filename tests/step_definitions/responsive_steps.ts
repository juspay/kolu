import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I click the sidebar toggle", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="sidebar-toggle"]').click();
  await this.waitForFrame();
});

When("I click the sidebar backdrop", async function (this: KoluWorld) {
  const backdrop = this.page.locator('[data-testid="sidebar-backdrop"]');
  // Click right side of backdrop (past the w-48 sidebar) to avoid hitting sidebar panel
  const box = await backdrop.boundingBox();
  assert.ok(box, "Backdrop has no bounding box");
  await backdrop.click({ position: { x: box.width - 10, y: box.height / 2 } });
  await this.waitForFrame();
});

Then("the sidebar should be visible", async function (this: KoluWorld) {
  const sidebar = this.page.locator('[data-testid="sidebar"]');
  await sidebar.waitFor({ state: "attached" });
  const visible = await sidebar.isVisible();
  assert.ok(visible, "Expected sidebar to be visible");
});

Then("the sidebar should not be visible", async function (this: KoluWorld) {
  const sidebar = this.page.locator('[data-testid="sidebar"]');
  // Wait for CSS transition to complete — use waitForFunction to check computed visibility
  await this.page.waitForFunction(
    () => {
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      if (!sidebar) return true;
      const box = sidebar.getBoundingClientRect();
      // Hidden: either display:none (no box) or translated off-screen
      return box.width === 0 || box.x + box.width <= 0;
    },
    { timeout: 3000 },
  );
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
