/** Compact layout (roomy touch device — Z Fold 6 unfolded, tablets) — step
 *  definitions. The compact layout is a persistent dock rail beside the active
 *  terminal, in place of the phone's swipe drawer and the desktop's pan/zoom
 *  canvas. */

import { Then } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const COMPACT_RAIL = '[data-testid="compact-dock-rail"]';
const DOCK_HANDLE = '[data-testid="mobile-dock-handle"]';
const CHROME_BAR = '[data-testid="chrome-bar"]';

Then(
  "the compact dock rail should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMPACT_RAIL)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// The persistent rail replaces the phone's left-edge swipe drawer, so its
// handle must not be rendered — proving compact didn't just inherit the phone
// layout wholesale.
Then(
  "the mobile dock handle should not be present",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_HANDLE)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

// The desktop ChromeBar is a mouse-pointer affordance; a coarse-pointer compact
// device must not get it (regression cover for the original bug — the unfolded
// Fold showing the full desktop chrome).
Then(
  "the desktop chrome bar should not be present",
  async function (this: KoluWorld) {
    await this.page
      .locator(CHROME_BAR)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);
