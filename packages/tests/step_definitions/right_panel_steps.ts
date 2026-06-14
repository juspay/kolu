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
    // The right-panel toggle in the header — `data-testid="inspector-toggle"`
    // (the test-id is kept stable even though the visible label is now
    // "Toggle right panel").
    const toggle = this.page.locator('header [data-testid="inspector-toggle"]');
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
  "the inspector should show the kaval-tui attach command",
  async function (this: KoluWorld) {
    // The Attach section renders a copy button carrying the short-form
    // `kaval-tui attach <id>` command for the active terminal. We assert the
    // whole deliberate contract: the button SHOWS the short id, its `title`
    // carries the FULL command (the on-hover disambiguator), and CLICKING it
    // copies the short form (WYSIWYG-copy) — not just that some text matches.
    const attach = this.page.locator(
      '[data-testid="inspector-attach-command"]',
    );
    await attach.waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    const visible = (await attach.textContent())?.trim() ?? "";
    const shortId = visible.match(/kaval-tui attach (\S+)/)?.[1] ?? "";
    // The displayed id is the short form (8 hex chars), not the full uuid.
    assert.ok(
      /^[0-9a-f]{8}$/.test(shortId),
      `Expected the shown command to carry an 8-char short id, got "${visible}"`,
    );

    // The hover/title fallback carries the FULL command — its id starts with
    // the shown short id and is the full-length uuid (longer than 8 chars).
    const title = (await attach.getAttribute("title")) ?? "";
    const fullId = title.match(/^kaval-tui attach (\S+)$/)?.[1] ?? "";
    assert.ok(
      fullId.startsWith(shortId) && fullId.length > 8,
      `Expected the title to carry the full attach command, got "${title}"`,
    );

    // Clicking copies the SHORT command (the deliberate WYSIWYG-copy decision).
    await attach.click();
    await this.page.waitForFunction(
      (exp) => navigator.clipboard.readText().then((t) => t === exp),
      `kaval-tui attach ${shortId}`,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector toggle should not be active",
  async function (this: KoluWorld) {
    // The header toggle drops its `data-active` marker when the panel isn't
    // effectively open — which an empty workspace forces regardless of the
    // collapsed preference.
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          'header [data-testid="inspector-toggle"]',
        );
        return !!btn && !btn.hasAttribute("data-active");
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector toggle should be disabled",
  async function (this: KoluWorld) {
    // Use the `:disabled` selector with waitFor so the assertion polls until
    // SolidJS reactivity has flushed the `disabled` attribute onto the button —
    // the same idiom as "the Code tab back/forward button should be disabled".
    // A bare isDisabled() snapshot after waitFor(attached) is a race: the
    // element can exist in the DOM before the reactive flush propagates
    // `disabled={true}`.
    const toggle = this.page.locator(
      'header [data-testid="inspector-toggle"]:disabled',
    );
    await toggle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the chrome bar should reserve no right-panel space",
  async function (this: KoluWorld) {
    // The ghost: the floating chrome's inline `right` offset reserves the
    // panel's width. With no panel mounted it must collapse to 0 so the
    // control cluster sits flush against the viewport's right edge.
    await this.page.waitForFunction(
      () => {
        const bar = document.querySelector('[data-testid="chrome-bar"]');
        if (!bar) return false;
        return getComputedStyle(bar).right === "0px";
      },
      null,
      { timeout: POLL_TIMEOUT },
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
        // ::before spans [-4, +4) — `before:-left-1` puts its left edge
        // at -4, `before:w-2` makes it 8px wide, so its painted pixels
        // run -4..+3 inclusive (right edge at +4 is exclusive per CSS
        // box geometry). Sample at both inclusive boundaries plus three
        // interior points so the assertion enforces the full hit zone.
        for (const dx of [-4, -2, 0, 2, 3]) {
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
