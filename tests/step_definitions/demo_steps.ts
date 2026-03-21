/**
 * Demo recording steps — capture screenshots at a fixed interval
 * for later conversion to GIF/MP4 via ffmpeg.
 */

import { Given, When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const FRAME_DIR = path.resolve(import.meta.dirname, "..", "demo-frames");
const FPS = 10;

Given("frame capture is started", async function (this: KoluWorld) {
  fs.mkdirSync(FRAME_DIR, { recursive: true });
  this.demoFrameNum = 0;
  const interval = 1000 / FPS;

  this.demoInterval = setInterval(async () => {
    try {
      const padded = String(this.demoFrameNum++).padStart(5, "0");
      await this.page.screenshot({
        path: path.join(FRAME_DIR, `frame-${padded}.png`),
      });
    } catch {
      // Page may be closing — ignore
    }
  }, interval);
});

When("I wait {int} second(s)", async function (this: KoluWorld, secs: number) {
  await this.page.waitForTimeout(secs * 1000);
});

Then("frame capture is stopped", async function (this: KoluWorld) {
  if (this.demoInterval) {
    clearInterval(this.demoInterval);
    this.demoInterval = undefined;
  }
  console.log(`Captured ${this.demoFrameNum} frames to ${FRAME_DIR}/`);
});
