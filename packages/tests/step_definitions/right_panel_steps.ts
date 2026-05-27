import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

// ── Actions ──

When("I press the toggle inspector shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Alt+b`);
  await this.waitForFrame();
});

When("I collapse the right panel", async function (this: KoluWorld) {
  // RightPanel's chrome-bar collapse button — clicking it from the
  // expanded state toggles `rightPanel.collapsed` to true (Resizable
  // shrinks the panel to ~0 width while the DOM stays mounted).
  const btn = this.page.locator('button[aria-label="Collapse panel"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
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
  // Panel stays mounted across collapse so CodeTab's local state survives
  // (#818). In maximized mode the shell shrinks to 0 px; in tiled mode
  // the shell is `display: none`. Either way the inner panel's bounding
  // box reads zero width — assert that rather than `state: "hidden"`,
  // which doesn't trip for a width-0 element with the shell still in
  // the layout tree.
  await this.page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="right-panel"]');
      if (!el) return true;
      return (el as HTMLElement).getBoundingClientRect().width <= 1;
    },
    null,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the right panel should be in maximized mode",
  async function (this: KoluWorld) {
    // `data-maximized=""` is set on the right-panel shell when posture is
    // maximized — the shell renders as a flush flex sibling of the canvas
    // (real right panel) rather than the floating absolute overlay it
    // uses in tiled mode. Same attribute pattern as the dock.
    await this.page.waitForFunction(
      () => {
        const shell = document.querySelector(
          '[data-testid="right-panel-shell"]',
        );
        return shell?.hasAttribute("data-maximized") ?? false;
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel should be in tiled mode",
  async function (this: KoluWorld) {
    // Absence of `data-maximized` on the shell = tiled posture (the
    // shell renders as an absolute float over the canvas grid).
    await this.page.waitForFunction(
      () => {
        const shell = document.querySelector(
          '[data-testid="right-panel-shell"]',
        );
        if (!shell) return false;
        return !shell.hasAttribute("data-maximized");
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

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
      text?.includes("Branch"),
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
