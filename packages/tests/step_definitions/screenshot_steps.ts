import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SCREENSHOT_BUTTON_SELECTOR = '[data-testid="canvas-tile-screenshot"]';
const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

Then(
  "the screenshot button should be visible on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const button = this.page
      .locator(`${CANVAS_SELECTOR} ${SCREENSHOT_BUTTON_SELECTOR}`)
      .nth(index - 1);
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the screenshot button should not be visible in the focus-mode chrome",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel: string) => document.querySelector(sel) === null,
      SCREENSHOT_BUTTON_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the screenshot button on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const button = this.page
      .locator(`${CANVAS_SELECTOR} ${SCREENSHOT_BUTTON_SELECTOR}`)
      .nth(index - 1);
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await button.click();
    await this.waitForFrame();
  },
);

When("I press the screenshot shortcut", async function (this: KoluWorld) {
  // Mod+Shift+S
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await this.page.keyboard.down(modifier);
  await this.page.keyboard.down("Shift");
  await this.page.keyboard.press("KeyS");
  await this.page.keyboard.up("Shift");
  await this.page.keyboard.up(modifier);
  await this.waitForFrame();
});

Then(
  "the clipboard should contain a PNG image",
  async function (this: KoluWorld) {
    // navigator.clipboard.read() returns ClipboardItem[]; each item exposes
    // .types. Poll until at least one item advertises image/png, which
    // confirms the screenshot write succeeded.
    await this.page.waitForFunction(
      async () => {
        const items = await navigator.clipboard.read().catch(() => []);
        return items.some((item) => item.types.includes("image/png"));
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
