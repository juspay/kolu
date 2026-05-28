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
    // Force the active canvas tile's right edge to coincide with the
    // handle's left edge before sampling. Canvas tiles use
    // `position: absolute; z-index: 10` only when active (inactive tiles
    // sit at z-index: 1 and cannot shadow the handle), so a generic
    // `[data-testid="canvas-tile"]` lookup could pick an inactive tile,
    // shift an irrelevant element, and silently pass. Without this
    // step the default tile placement might not reach the boundary at
    // all, and the assertion would only mean "no tile happened to
    // overlap" — not "the handle stacks above tiles when they do."
    //
    // Positioning happens via the absolute `left` offset rather than by
    // appending to the inline `transform`. That keeps the test on the
    // tile's stable boundary (its bounding rect's right edge) instead
    // of riding on `CanvasTile`'s internal transform composition — a
    // separate volatility axis the assertion has no business coupling
    // to.
    //
    // Double-rAF before sampling so SolidJS reactivity + Corvu's
    // Resizable transitions are flushed — without it, a stale layout
    // snapshot could either silently pass (tile not yet at boundary)
    // or flake on slower CI runners. The detailed `dead` list in the
    // failure message is worth keeping over a generic
    // `waitForFunction` timeout: it names the exact (x, y) and the
    // covering element so a regression points at its cause.
    await this.waitForFrame();
    const result = await this.page.evaluate(() => {
      const handle = document.querySelector(
        '[data-testid="right-panel-handle"]',
      );
      if (!handle) return { ok: false, setupError: "handle missing" } as const;
      const tile = document.querySelector(
        '[data-testid="canvas-tile"][data-active="true"]',
      ) as HTMLElement | null;
      if (!tile) {
        return {
          ok: false,
          setupError: "active tile missing",
        } as const;
      }
      const handleRect = handle.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      const currentLeft = parseFloat(tile.style.left || "0");
      const shift = handleRect.left - tileRect.right;
      tile.style.left = `${currentLeft + shift}px`;
      const newTileRect = tile.getBoundingClientRect();
      const dead: { x: number; y: number; covered: string }[] = [];
      for (const yFrac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const y = newTileRect.top + newTileRect.height * yFrac;
        // ::before extends to ±4px (`before:-left-1 before:w-2`); sample
        // its full extent so the assertion enforces the whole hit zone.
        for (const dx of [-4, -2, 0, 2, 4]) {
          const x = handleRect.left + dx;
          const el = document.elementFromPoint(x, y);
          const id = el?.getAttribute("data-testid");
          if (id !== "right-panel-handle") {
            dead.push({ x, y, covered: id ?? el?.tagName ?? "<null>" });
          }
        }
      }
      return { ok: dead.length === 0, dead } as const;
    });
    if (!result.ok && "setupError" in result) {
      assert.fail(`Setup failed: ${result.setupError}`);
    }
    assert.ok(
      result.ok,
      `Resize handle is shadowed at: ${JSON.stringify("dead" in result ? result.dead : [])}`,
    );
  },
);
