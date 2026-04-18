import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
const SHORTCUTS_HELP_SELECTOR = '[data-testid="shortcuts-help"]';

When("I press the shortcuts help shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+/`);
  await this.waitForFrame();
});

When(
  "I press the switch to terminal {int} shortcut",
  async function (this: KoluWorld, n: number) {
    await this.page.keyboard.press(`${MOD_KEY}+${n}`);
  },
);

When("I press the next terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketRight`);
});

When("I press the prev terminal shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+BracketLeft`);
});

When("I jump to the previous terminal", async function (this: KoluWorld) {
  await this.page.keyboard.down("Control");
  await this.page.keyboard.press("Tab");
  await this.page.keyboard.up("Control");
  await this.waitForFrame();
});

When(
  "I cycle {int} terminals back by holding Ctrl+Tab",
  async function (this: KoluWorld, n: number) {
    await this.page.keyboard.down("Control");
    for (let i = 0; i < n; i++) await this.page.keyboard.press("Tab");
    await this.page.keyboard.up("Control");
    await this.waitForFrame();
  },
);

When("I press the create terminal shortcut", async function (this: KoluWorld) {
  const countBefore = await this.page
    .locator('[data-testid="canvas-tile"][data-terminal-id]')
    .count();
  await this.page.keyboard.press(`${MOD_KEY}+t`);
  // Wait for a new sidebar entry to appear
  await this.page
    .locator('[data-testid="canvas-tile"][data-terminal-id]')
    .nth(countBefore)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I press the screenshot terminal shortcut",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${MOD_KEY}+Shift+S`);
    await this.waitForFrame();
  },
);

Then(
  "the clipboard image should not be blank",
  async function (this: KoluWorld) {
    // Guards against the html-to-image regression (#589 follow-up) where
    // `toBlob` returned a transparent PNG because Chromium's SVG
    // foreignObject pipeline failed silently. This verification samples
    // the clipboard PNG — if every pixel is transparent or every pixel
    // is pure black, the capture didn't render anything useful.
    const result = await this.page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!item.types.includes("image/png")) continue;
        const blob = await item.getType("image/png");
        const dataUrl = await new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.readAsDataURL(blob);
        });
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("image decode failed"));
          img.src = dataUrl;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return { error: "no 2d ctx" };
        ctx.drawImage(img, 0, 0);
        const full = ctx.getImageData(
          0,
          0,
          img.naturalWidth,
          img.naturalHeight,
        ).data;
        const unique = new Set<string>();
        // Stride-2 scan of every pixel — catches glyphs at any row/column.
        for (let i = 0; i < full.length; i += 8) {
          unique.add(`${full[i]},${full[i + 1]},${full[i + 2]},${full[i + 3]}`);
          if (unique.size > 16) break;
        }
        return {
          width: img.naturalWidth,
          height: img.naturalHeight,
          uniqueColors: unique.size,
        };
      }
      return { error: "no image/png in clipboard" };
    });
    if ("error" in result) throw new Error(result.error);
    if (result.uniqueColors < 2) {
      throw new Error(
        `clipboard image appears blank: ${result.width}×${result.height} with ${result.uniqueColors} unique sampled color(s)`,
      );
    }
  },
);

When("I click outside the shortcuts help", async function (this: KoluWorld) {
  await this.page.mouse.click(10, 10);
});

Then("the shortcuts help should be visible", async function (this: KoluWorld) {
  const help = this.page.locator(SHORTCUTS_HELP_SELECTOR);
  await help.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the shortcuts help should not be visible",
  async function (this: KoluWorld) {
    const help = this.page.locator(SHORTCUTS_HELP_SELECTOR);
    await help.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);
