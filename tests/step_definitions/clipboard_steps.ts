import { When } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";

/**
 * Draw a 1×1 pixel on an OffscreenCanvas and write the resulting PNG
 * blob to the browser clipboard. This produces a valid PNG that
 * Chromium's clipboard API will accept.
 */
When(
  "I place an image in the browser clipboard",
  async function (this: KoluWorld) {
    await this.page.evaluate(async () => {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    });
  },
);

/**
 * Press Ctrl+V in the terminal, triggering the client-side clipboard
 * image upload flow (reads browser clipboard → pasteImage RPC → \x16).
 */
When("I press Ctrl+V in the terminal", async function (this: KoluWorld) {
  await this.canvas.click();
  await this.page.keyboard.press("Control+v");
  // Wait for the async clipboard read + RPC upload to complete
  await this.page.waitForTimeout(1500);
});
