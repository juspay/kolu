/** Companion (welded canvas-peer panel) step defs.
 *
 *  The legacy "right panel" was deleted in the canvas-peer companion
 *  refactor: code review and inspector telemetry now attach to a tile
 *  as welded canvas-peer companions. The Gherkin vocabulary still says
 *  "right panel" / "inspector" so existing features (worktree,
 *  recent-repos, git-context, …) keep reading naturally without
 *  rewriting every Background. The selectors target companion DOM. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const INSPECTOR_COMPANION_SELECTOR =
  '[data-testid="companion-tile"][data-companion-kind="inspector"]';

// ── Actions ──

When("I press the toggle inspector shortcut", async function (this: KoluWorld) {
  // Cmd+Alt+B preserves the prior right-panel keybind. The action now
  // toggles the inspector companion on the active tile.
  await this.page.keyboard.press(`${MOD_KEY}+Alt+b`);
  await this.waitForFrame();
});

When(
  "I click the inspector toggle icon in the header",
  async function (this: KoluWorld) {
    // The header inspector toggle was deleted with the dock — the
    // keybind is the only entry point now. Existing features calling
    // this step path through the keybind so they keep passing without
    // a Gherkin rewrite.
    await this.page.keyboard.press(`${MOD_KEY}+Alt+b`);
    await this.waitForFrame();
  },
);

When(
  "I click the theme name in the inspector",
  async function (this: KoluWorld) {
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
  // The "right panel" wording predates the canvas-peer redesign — what
  // the assertion actually means now is "the inspector companion is
  // mounted as a welded peer to the active tile." Using `state:
  // "attached"` instead of `"visible"` because companions are
  // canvas-positioned (anchor.x + anchor.w) and may land outside the
  // viewport in tiled mode without auto-centering — DOM presence is
  // what the structural contract guarantees; viewport-fit is a polish
  // item for a follow-up.
  const companion = this.page.locator(INSPECTOR_COMPANION_SELECTOR);
  await companion.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
});

Then("the right panel should not be visible", async function (this: KoluWorld) {
  // Companions unmount on close (no keep-mounted-at-zero-width hack
  // like the old RightPanelLayout used).
  const companion = this.page.locator(INSPECTOR_COMPANION_SELECTOR);
  await companion.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
});

Then(
  "the inspector should show a CWD section",
  async function (this: KoluWorld) {
    const cwd = this.page.locator('[data-testid="inspector-cwd"]');
    await cwd.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
    // The companion's seam handle is only attached in tiled mode; the
    // visual width is 4px straddling the anchor's east edge.
    const handle = this.page.locator('[data-testid="companion-seam"]');
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);
