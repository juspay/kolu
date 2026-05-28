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
  // "Visible" means the tab content area exists — assert one of its
  // tab buttons is reachable (the expanded Resizable panel shows the tab bar).
  const tab = this.page.locator('[data-testid="right-panel-tab-inspector"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the right panel should not be visible", async function (this: KoluWorld) {
  // The Resizable panel collapses to 0 width (no rail or visible indicator).
  // `data-collapsed` on the RightPanel root is the canonical state seam.
  await this.page.waitForFunction(
    () => {
      const shell = document.querySelector('[data-testid="right-panel"]');
      if (!shell) return true;
      return shell.hasAttribute("data-collapsed");
    },
    null,
    { timeout: POLL_TIMEOUT },
  );
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

Then(
  "the right panel resize handle should be hittable at its full width",
  async function (this: KoluWorld) {
    // The outer handle's ::before extends `before:-left-1 before:w-2`
    // (-4px..+4px from the handle's left edge in Tailwind units). Sample
    // points across that 8px-wide strip and assert each one resolves to
    // the handle button via elementFromPoint.
    //
    // Force the canvas tile's right edge to coincide with the handle's
    // left edge before sampling. Canvas tiles use
    // `position: absolute; z-index: 10`; without this step the default
    // tile placement might not reach the boundary, and a passing
    // assertion would only mean "no tile happened to overlap" — not
    // "the handle stacks above tiles when they do."
    const result = await this.page.evaluate(() => {
      const handle = document.querySelector(
        '[data-testid="right-panel-handle"]',
      );
      if (!handle) return { ok: false, dead: [{ reason: "handle missing" }] };
      const tile = document.querySelector(
        '[data-testid="canvas-tile"]',
      ) as HTMLElement | null;
      if (!tile) return { ok: false, dead: [{ reason: "tile missing" }] };
      const handleRect = handle.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      // Shift the tile so its right edge lands exactly on handle.left.
      // CanvasTile sets its transform inline; appending a translateX
      // shift preserves whatever the canvas arranger computed.
      const shift = handleRect.left - tileRect.right;
      tile.style.transform = `${tile.style.transform} translateX(${shift}px)`;
      const newTileRect = tile.getBoundingClientRect();
      const dead: { x: number; y: number; covered: string }[] = [];
      for (const yFrac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const y = newTileRect.top + newTileRect.height * yFrac;
        for (const dx of [-3, -1.5, 0, 1.5, 3]) {
          const x = handleRect.left + dx;
          const el = document.elementFromPoint(x, y);
          const id = el?.getAttribute("data-testid");
          if (id !== "right-panel-handle") {
            dead.push({ x, y, covered: id ?? el?.tagName ?? "<null>" });
          }
        }
      }
      return { ok: dead.length === 0, dead };
    });
    assert.ok(
      result.ok,
      `Resize handle is shadowed at: ${JSON.stringify(result.dead)}`,
    );
  },
);
