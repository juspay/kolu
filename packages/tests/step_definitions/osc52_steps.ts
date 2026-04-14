import { When } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";

/** Force navigator.clipboard.writeText to reject so the ClipboardAddon provider
 *  exercises the execCommand fallback path. Leaves readText intact so the
 *  clipboard-contents assertion can still read the system clipboard after
 *  the fallback writes to it. */
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
