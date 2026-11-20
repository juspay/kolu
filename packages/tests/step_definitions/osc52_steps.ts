import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

When(
  "I disable navigator.clipboard.writeText",
  async function (this: KoluWorld) {
    // Pass evaluate a string to sidestep tsx/esbuild's `__name` helper
    // injection, which breaks when the serialized function is evaluated
    // in the browser (see playwright/playwright#31105).
    await this.page.evaluate(`
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new Error("clipboard disabled for test"))
      });
    `);
  },
);
