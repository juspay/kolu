import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

const PALETTE_SELECTOR = '[data-testid="command-palette"]';

// ── Actions ──

When("I press the toggle inspector shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+b`);
  await this.waitForFrame();
});

When("I click the edge strip", async function (this: KoluWorld) {
  const strip = this.page.locator('[data-testid="right-panel-strip"]');
  await strip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await strip.click();
  await this.waitForFrame();
});

When(
  "I click the inspector toggle icon in the header",
  async function (this: KoluWorld) {
    // The inspector toggle is the right-oriented PanelToggleIcon in the header.
    // It doesn't have a dedicated data-testid, so locate by aria-label.
    const toggle = this.page.locator(
      'header button[aria-label*="Toggle inspector"]',
    );
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await toggle.click();
    await this.waitForFrame();
  },
);

When(
  "I click the desktop sidebar toggle icon",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="sidebar-toggle-desktop"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await toggle.click();
    await this.waitForFrame();
  },
);

When(
  "I click the theme name in the inspector",
  async function (this: KoluWorld) {
    // The theme section in MetadataInspector renders a clickable button with the theme name.
    const themeButton = this.page.locator(
      '[data-testid="inspector-theme-button"]',
    );
    await themeButton.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await themeButton.click();
    await this.waitForFrame();
  },
);

// ── Assertions ──

Then("the right panel should be visible", async function (this: KoluWorld) {
  const panel = this.page.locator('[data-testid="right-panel"]');
  await panel.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the right panel should not be visible", async function (this: KoluWorld) {
  const panel = this.page.locator('[data-testid="right-panel"]');
  await panel.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then("the edge strip should be visible", async function (this: KoluWorld) {
  const strip = this.page.locator('[data-testid="right-panel-strip"]');
  await strip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the inspector should show a CWD section",
  async function (this: KoluWorld) {
    const cwd = this.page.locator('[data-testid="inspector-cwd"]');
    await cwd.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // CWD section should contain a non-empty path
    const text = await cwd.textContent();
    assert.ok(
      text && text.trim().length > 0,
      `Expected inspector CWD to have content, got "${text}"`,
    );
  },
);

Then(
  "the inspector should show a git branch section",
  async function (this: KoluWorld) {
    // The test suite runs inside a git repo, so the git section should be present.
    const git = this.page.locator('[data-testid="inspector-branch"]');
    await git.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await git.textContent();
    assert.ok(
      text && text.includes("Branch"),
      `Expected inspector git section to show branch info, got "${text}"`,
    );
  },
);

Then(
  "the inspector should show a theme section",
  async function (this: KoluWorld) {
    // Theme section renders a clickable button with the theme name inside the right panel.
    const themeButton = this.page.locator(
      '[data-testid="inspector-theme-button"]',
    );
    await themeButton.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await themeButton.textContent();
    assert.ok(
      text && text.trim().length > 0,
      `Expected inspector theme section to have a theme name, got "${text}"`,
    );
  },
);

Then(
  "the right panel resize handle should be visible",
  async function (this: KoluWorld) {
    // Handle uses w-0 with ::before pseudo-element — check attached, not visible
    const handle = this.page.locator('[data-testid="right-panel-handle"]');
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);
