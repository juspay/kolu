import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

type RetainedViews = {
  __retainedPanel?: Element | null;
  __retainedTerminal?: Element;
  __retainedXterm?: object;
};
type TerminalElement = Element & { __xterm?: object };

const COMPACT_RAIL = '[data-testid="compact-dock-rail"]';
const DOCK_HANDLE = '[data-testid="mobile-dock-handle"]';
const CHROME_BAR = '[data-testid="chrome-bar"]';
const EMPTY_STATE = '[data-testid="empty-state"]';
const EMPTY_CREATE = '[data-testid="empty-create-terminal"]';
const DESKTOP_DOCK = '[data-testid="dock"]';

Then(
  "the compact dock rail should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMPACT_RAIL)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile dock handle should not be present",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_HANDLE)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the desktop chrome bar should not be present",
  async function (this: KoluWorld) {
    await this.page
      .locator(CHROME_BAR)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the empty state create button should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(EMPTY_STATE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(EMPTY_CREATE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the desktop dock should not be present",
  async function (this: KoluWorld) {
    await this.page
      .locator(DESKTOP_DOCK)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When("I tap the empty state create button", async function (this: KoluWorld) {
  await this.page.locator(EMPTY_CREATE).click({ timeout: POLL_TIMEOUT });
});

When("I mark the touch workspace views", async function (this: KoluWorld) {
  await this.page.getByTestId("right-panel").waitFor({ state: "attached" });
  await this.page.locator("[data-terminal-id][data-focused]").evaluate((el) => {
    (window as Window & RetainedViews).__retainedPanel = document.querySelector(
      '[data-testid="right-panel"]',
    );
    (window as Window & RetainedViews).__retainedTerminal = el;
    (window as Window & RetainedViews).__retainedXterm = (
      el as TerminalElement
    ).__xterm;
  });
});
When(
  "I resize the touch viewport to {word}",
  async function (this: KoluWorld, mode: string) {
    await this.page.setViewportSize(
      mode === "phone"
        ? { width: 390, height: 844 }
        : { width: 900, height: 1000 },
    );
    await this.page
      .locator(
        mode === "phone" ? '[data-testid="mobile-dock-handle"]' : COMPACT_RAIL,
      )
      .waitFor({ state: "visible" });
  },
);
Then(
  "the touch workspace views should retain their identities",
  async function (this: KoluWorld) {
    const same = await this.page
      .locator("[data-terminal-id][data-focused]")
      .evaluate(
        (el) =>
          (window as Window & RetainedViews).__retainedPanel ===
            document.querySelector('[data-testid="right-panel"]') &&
          (window as Window & RetainedViews).__retainedTerminal === el &&
          (window as Window & RetainedViews).__retainedXterm ===
            (el as TerminalElement).__xterm &&
          !!(el as TerminalElement).__xterm,
      );
    if (!same)
      throw new Error(
        "App replaced the terminal body or xterm across a touch layout change",
      );
  },
);
