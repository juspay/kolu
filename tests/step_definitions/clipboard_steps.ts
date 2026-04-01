import { When } from "@cucumber/cucumber";
import { KoluWorld, MOD_KEY } from "../support/world.ts";

/**
 * Simulate the full image paste flow: write a valid PNG to the browser
 * clipboard, then press Ctrl+V so the browser fires a real paste event
 * with the image in clipboardData. The terminal's capture-phase paste
 * listener reads it and uploads to the server shim.
 *
 * Only clipboard-write permission is needed (for test setup). The paste
 * event provides clipboard data without clipboard-read permission —
 * matching production behavior.
 */
When("I paste an image into the terminal", async function (this: KoluWorld) {
  // Write a 1×1 PNG to the system clipboard
  await this.page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  });

  // Focus the terminal and press paste shortcut — the browser fires a real
  // paste event with the clipboard image data (no clipboard-read needed).
  await this.canvas.click();
  await this.page.keyboard.press(`${MOD_KEY}+v`);

  // Wait for the upload RPC acknowledgement — the terminal buffer will
  // contain the uploaded file path once the server responds.
  await this.waitForFrame();
  await this.waitForFrame();
});
