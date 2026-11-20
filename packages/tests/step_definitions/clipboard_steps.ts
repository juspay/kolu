import { When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY } from "../support/world.ts";

When("I paste an image into the terminal", async function (this: KoluWorld) {
  await this.page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas getContext('2d') unavailable");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  });

  await this.canvas.click();
  await this.page.keyboard.press(`${MOD_KEY}+v`);

  await this.waitForFrame();
  await this.waitForFrame();
});
