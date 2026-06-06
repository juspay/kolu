import { pause } from "./helpers";
import type { Recording } from "./types";

/**
 * The PWA install story: summon the welcome (the "Tutorial" palette command,
 * which carries the "Pin it" card) and reveal the install affordance. Captured
 * in BROWSER chrome (tabs + address bar) — installing as an app only makes
 * sense shown in a real browser. Summoning via the palette is robust regardless
 * of whether the canvas is empty. Reveals whichever install state the runtime
 * is in: the one-click button (Chromium + install event) or the per-browser
 * manual steps.
 */
export const recording: Recording = {
  name: "pwa-install",
  chrome: "browser",
  theme: "Vaughn",
  caption: "Pin kolu as an app — install it from the welcome.",
  display: { hideDock: true, hideMinimap: true },
  async drive(world) {
    const page = world.page;
    await world.waitForReady();
    await pause(world, 1000);

    // Summon the welcome overlay (carries the install card) — Linux capture box,
    // so the palette chord is Ctrl+K.
    await page.keyboard.press("Control+k");
    await pause(world, 700);
    await page.keyboard.type("Tutorial");
    await pause(world, 700);
    await page.keyboard.press("Enter");
    await pause(world, 1600);

    const oneClick = page.locator('[data-testid="welcome-install"]');
    const manualSummary = page.locator(
      '[data-testid="welcome-install-manual"] summary',
    );

    if (await oneClick.isVisible().catch(() => false)) {
      // Chromium one-click path: hover then press Install — Chrome's native
      // install prompt appears (x11grab captures it; it's on-screen chrome).
      await oneClick.hover().catch(() => undefined);
      await pause(world, 800);
      await oneClick.click({ timeout: 2000 }).catch(() => undefined);
      await pause(world, 3000);
    } else if (await manualSummary.isVisible().catch(() => false)) {
      // Manual path: expand the per-browser instruction steps.
      await manualSummary.click({ timeout: 2000 }).catch(() => undefined);
      await pause(world, 3000);
    } else {
      // Card absent (already installed, or no welcome) — dwell on the overlay.
      await pause(world, 2800);
    }
  },
};
