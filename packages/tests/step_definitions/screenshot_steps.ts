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

Then(
  "the clipboard should contain a PNG image",
  async function (this: KoluWorld) {
    // navigator.clipboard.read() returns ClipboardItem[]; each item exposes
    // .types. Poll until at least one item advertises image/png AND the blob
    // actually carries a PNG signature (first 8 bytes `89 50 4E 47 0D 0A 1A 0A`).
    // The signature check guards against a "succeeded but captured blank" bug —
    // a blank canvas still produces a valid PNG, but we go further and confirm
    // at least one non-zero pixel so a backbuffer clear (e.g., if onRender
    // timing regresses) would surface as a test failure.
    await this.page.waitForFunction(
      async () => {
        const items = await navigator.clipboard.read().catch(() => []);
        for (const item of items) {
          if (!item.types.includes("image/png")) continue;
          const blob = await item.getType("image/png");
          const buf = new Uint8Array(await blob.arrayBuffer());
          const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
          if (!PNG_SIG.every((b, i) => buf[i] === b)) return false;
          // Decode to confirm pixel content is non-uniform (not all one color).
          const bmp = await createImageBitmap(blob);
          const c = document.createElement("canvas");
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext("2d");
          if (!ctx) return false;
          ctx.drawImage(bmp, 0, 0);
          const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          const r0 = px[0],
            g0 = px[1],
            b0 = px[2];
          for (let i = 4; i < px.length; i += 4) {
            if (px[i] !== r0 || px[i + 1] !== g0 || px[i + 2] !== b0)
              return true;
          }
          return false;
        }
        return false;
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);
