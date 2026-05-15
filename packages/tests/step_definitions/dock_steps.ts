/** Dock — step definitions. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const RAIL_SELECTOR = '[data-testid="dock-rail"]';
const MODE_TOGGLE_SELECTOR = '[data-testid="dock-mode-toggle"]';
const CARD_SELECTOR = '[data-testid="dock-card"]';
const WORKING_SELECTOR = '[data-testid="dock-working"]';
const QUIET_FOREGROUND_SELECTOR = '[data-testid="dock-quiet-foreground"]';
const CHROME_DOCK_TOGGLE_SELECTOR = '[data-testid="dock-toggle"]';

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
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: CARD_SELECTOR, count: expected },
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
      { selector: WORKING_SELECTOR, count: expected },
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
  // `Cmd+B` (or `Ctrl+B` on non-macOS) drives `toggleDock` — same
  // behavior as the chrome-bar dock-toggle button and the in-header
  // chevron.
  await this.page.keyboard.press(`${MOD_KEY}+b`);
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
