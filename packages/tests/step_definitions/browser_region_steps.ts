import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_TILE = '[data-testid="canvas-tile"]';
const TOGGLE_BROWSER_BUTTON = '[data-testid="tile-toggle-browser"]';
const BROWSER_REGION = '[data-testid="browser-region"]';
const BROWSER_REGION_URL = '[data-testid="browser-region-url"]';
const BROWSER_REGION_IFRAME = '[data-testid="browser-region-iframe"]';
const BROWSER_REGION_CLOSE = '[data-testid="browser-region-close"]';

When(
  "I click the open-browser button on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const button = this.page
      .locator(CANVAS_TILE)
      .nth(index - 1)
      .locator(TOGGLE_BROWSER_BUTTON);
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await button.click();
    await this.waitForFrame();
  },
);

Then(
  "a browser region should be visible on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      ({
        tileSel,
        regionSel,
        idx,
      }: {
        tileSel: string;
        regionSel: string;
        idx: number;
      }) => {
        const tile = document.querySelectorAll(tileSel)[idx - 1];
        return tile?.querySelector(regionSel) !== null;
      },
      { tileSel: CANVAS_TILE, regionSel: BROWSER_REGION, idx: index },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "no browser region should be visible on canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    await this.page.waitForFunction(
      ({
        tileSel,
        regionSel,
        idx,
      }: {
        tileSel: string;
        regionSel: string;
        idx: number;
      }) => {
        const tile = document.querySelectorAll(tileSel)[idx - 1];
        return tile?.querySelector(regionSel) == null;
      },
      { tileSel: CANVAS_TILE, regionSel: BROWSER_REGION, idx: index },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I enter {string} into the terminal's browser URL bar",
  async function (this: KoluWorld, url: string) {
    const input = this.page.locator(BROWSER_REGION_URL).first();
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(url);
    await input.press("Enter");
    await this.waitForFrame();
  },
);

Then(
  "the browser region iframe src should contain {string}",
  async function (this: KoluWorld, needle: string) {
    await this.page.waitForFunction(
      ({ sel, needle }: { sel: string; needle: string }) => {
        const iframe = document.querySelector<HTMLIFrameElement>(sel);
        return iframe !== null && iframe.src.includes(needle);
      },
      { sel: BROWSER_REGION_IFRAME, needle },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the close button on the browser region of canvas tile {int}",
  async function (this: KoluWorld, index: number) {
    const button = this.page
      .locator(CANVAS_TILE)
      .nth(index - 1)
      .locator(BROWSER_REGION_CLOSE);
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await button.click();
    await this.waitForFrame();
  },
);
