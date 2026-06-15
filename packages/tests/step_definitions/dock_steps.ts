/** Dock — step definitions. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const RAIL_SELECTOR = '[data-testid="dock-rail"]';
const MODE_TOGGLE_SELECTOR = '[data-testid="dock-mode-toggle"]';
// Row bucket is the semantic state we assert against — the unified
// DockRow component carries `data-bucket="awaiting|working|idle|none"`
// instead of branching its testid by bucket.
const AWAITING_ROW_SELECTOR =
  '[data-testid="dock-row"][data-bucket="awaiting"]';
const WORKING_ROW_SELECTOR = '[data-testid="dock-row"][data-bucket="working"]';
const QUIET_FOREGROUND_SELECTOR = '[data-testid="dock-quiet-foreground"]';
const CHROME_DOCK_TOGGLE_SELECTOR = '[data-testid="dock-toggle"]';
const DOCK_WINDOW_TRIGGER_SELECTOR = '[data-testid="dock-window-trigger"]';
const HIDDEN_FOOTER_SELECTOR = '[data-testid="dock-hidden-footer"]';

Then("the dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

// The dock defaults to "cards" mode now (#903 — primary navigator).
// "Expanded" semantically means cards mode, so this step ensures the
// dock is not in rail mode, clicking the header chevron to expand if
// needed. Mega mode counts as "expanded enough" for assertions that
// only check for the presence of cards/pills.
When("the dock is expanded", async function (this: KoluWorld) {
  const dock = this.page.locator(DOCK_SELECTOR);
  await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await dock.getAttribute("data-mode")) === "rail") {
    await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  }
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") !== "rail",
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then("the dock should not be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
});

Then(
  "the dock should show {int} card(s)",
  async function (this: KoluWorld, expected: number) {
    // "card" is the legacy name for an awaiting row — the bare dock no
    // longer has a distinct full-card variant, but the feature file
    // still reads "1 card" and that maps cleanly onto the awaiting
    // bucket count.
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: AWAITING_ROW_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} working pill(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: WORKING_ROW_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the dock should default to cards mode", async function (this: KoluWorld) {
  const dock = this.page.locator(DOCK_SELECTOR);
  await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const mode = await dock.getAttribute("data-mode");
  if (mode !== "cards") {
    throw new Error(`Expected dock mode "cards", got "${mode}"`);
  }
});

Then(
  "the dock should be in {string} mode",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ selector, mode }) =>
        document.querySelector(selector)?.getAttribute("data-mode") === mode,
      { selector: DOCK_SELECTOR, mode: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I collapse the dock to rail", async function (this: KoluWorld) {
  await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") === "rail",
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click rail segment {int}",
  async function (this: KoluWorld, position: number) {
    const rail = this.page.locator(RAIL_SELECTOR).nth(position - 1);
    await rail.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await rail.click();
    await this.waitForFrame();
  },
);

When("I press the dock toggle shortcut", async function (this: KoluWorld) {
  // `Cmd+Shift+B` (or `Ctrl+Shift+B` on non-macOS) drives
  // `toggleDock` — same behavior as the chrome-bar dock-toggle
  // button and the in-header chevron. Ctrl+B without shift is
  // reserved for the PTY (see prohibitedKeybinds.ts).
  await this.page.keyboard.press(`${MOD_KEY}+Shift+B`);
  await this.waitForFrame();
});

When("I click the chrome-bar dock toggle", async function (this: KoluWorld) {
  const button = this.page.locator(CHROME_DOCK_TOGGLE_SELECTOR);
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

Then("the dock should be in maximized mode", async function (this: KoluWorld) {
  // `data-maximized=""` is set on the outer aside when posture is
  // maximized; the dock renders as a flex sibling of the canvas (real
  // left panel) rather than a floating absolute overlay.
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.hasAttribute("data-maximized"),
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When("I press and hold Mod", async function (this: KoluWorld) {
  await this.page.keyboard.down(MOD_KEY);
  await this.waitForFrame();
});

When("I release Mod", async function (this: KoluWorld) {
  await this.page.keyboard.up(MOD_KEY);
  await this.waitForFrame();
});

When(
  "I press shortcut {string}",
  async function (this: KoluWorld, chord: string) {
    // Translate the cucumber-friendly "Mod+..." into the platform-
    // specific Cmd/Ctrl that Playwright understands.
    const resolved = chord.replace(/\bMod\b/g, MOD_KEY);
    await this.page.keyboard.press(resolved);
    await this.waitForFrame();
  },
);

const SHORTCUT_HINT_SELECTOR = '[data-testid="dock-row-shortcut-hint"]';
// The active row is identified by the `data-active` attribute on the row
// itself — the visual treatment (lifted-card geometry, accent flood,
// pop-in animation) is painted by CSS keyed on that attribute. See the
// "Active dock row" section in `packages/client/src/index.css`.
const ACTIVE_INDICATOR_SELECTOR = '[data-testid="dock-row"][data-active]';

Then(
  "the dock should show {int} active row indicator",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: ACTIVE_INDICATOR_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Repo-identity treatment: the section element draws the spine from a
// per-section `--repo-color` custom property (the single source the
// header tint and the name colour also read). Assert the structural
// facts via computed style, never a class name (e2e-testing rule): the
// 3px solid left border exists AND its colour resolves to the same value
// as `--repo-color` — so a regression to e.g. `border-left: 3px solid
// red` (a non-repo hue) fails the scenario rather than slipping through.
// `--repo-color` is an oklch() literal while `borderLeftColor` resolves
// to the browser's rgb form, so we normalise both through a throwaway
// probe element and compare the computed results.
Then(
  "the dock section should carry a repo-colour spine",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const sec = document.querySelector(sel);
        if (!sec) return false;
        const cs = getComputedStyle(sec);
        const repoColor = cs.getPropertyValue("--repo-color").trim();
        // Throw rather than returning false so a missing/empty --repo-color
        // surfaces a clear diagnostic instead of a generic timeout.
        if (repoColor === "")
          throw new Error(
            `[data-testid="dock-section"] has no --repo-color custom property set`,
          );
        if (cs.borderLeftStyle !== "solid" || cs.borderLeftWidth !== "3px") {
          return false;
        }
        // Validate before assigning: an invalid colour value is silently
        // rejected by the browser, causing getComputedStyle to fall back to
        // the inherited colour and producing a false positive/negative.
        if (!CSS.supports("color", repoColor))
          throw new Error(`--repo-color is not a valid CSS colour: "${repoColor}"`);
        // Resolve the raw `--repo-color` literal to the same computed
        // colour form `borderLeftColor` already reports, then compare.
        const probe = document.createElement("span");
        probe.style.color = repoColor;
        document.body.appendChild(probe);
        const resolvedRepoColor = getComputedStyle(probe).color;
        probe.remove();
        return cs.borderLeftColor === resolvedRepoColor;
      },
      '[data-testid="dock-section"]',
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock section header should be sticky",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const header = document.querySelector(sel);
        return !!header && getComputedStyle(header).position === "sticky";
      },
      '[data-testid="dock-section-header"]',
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "no dock-row shortcut hints should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 0,
      SHORTCUT_HINT_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} shortcut hints",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: SHORTCUT_HINT_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} foreground row containing {string}",
  async function (this: KoluWorld, expected: number, fragment: string) {
    // Foreground process line lives on quiet (idle/parked/none) rows
    // via `dock-quiet-foreground`. The text reads `meta.foreground.title
    // || .name` — a long-running shell command like `sleep N` will
    // populate it once the server publishes the new metadata.
    await this.page.waitForFunction(
      ({ selector, frag, count }) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        const matches = nodes.filter((n) =>
          (n.textContent ?? "").includes(frag),
        );
        return matches.length === count;
      },
      {
        selector: QUIET_FOREGROUND_SELECTOR,
        frag: fragment,
        count: expected,
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock window trigger should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_WINDOW_TRIGGER_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  /^the dock window should be "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el?.getAttribute("data-window") === want;
      },
      { sel: DOCK_WINDOW_TRIGGER_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the dock window trigger", async function (this: KoluWorld) {
  const button = this.page.locator(DOCK_WINDOW_TRIGGER_SELECTOR);
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

When(
  /^I pick the dock window option "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, value: string) {
    const opt = this.page.locator(
      `[data-testid="dock-window-option-${value}"]`,
    );
    await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await opt.click();
    await this.waitForFrame();
  },
);

// The footer tags itself `data-layout="rail"|"cards"`. The two layouts
// are different DOM (compact centered chip vs. inline sentence), so the
// attribute is the semantic signal that the reactive `<Show>` re-rendered
// the right branch after a mode toggle — not a frozen create-time choice.
Then(
  /^the dock hidden footer should use the "(rail|cards)" layout$/,
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) =>
        document.querySelector(sel)?.getAttribute("data-layout") === want,
      { sel: HIDDEN_FOOTER_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);
