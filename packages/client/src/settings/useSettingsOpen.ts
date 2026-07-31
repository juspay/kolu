/** The settings-popover open state, hoisted to a module singleton so BOTH the
 *  chrome trigger (the gear button in `ChromeBar` on desktop, `MobileChromeSheet`
 *  on touch) AND an out-of-band opener (the `#/settings` deep link) drive the one
 *  signal. Only one chrome surface mounts at a time (the `isDesktop()` gate), so
 *  the shared signal never has two live popovers.
 *
 *  Singleton pattern (per `.claude/rules/solidjs.md` — state per domain): the
 *  signal is created once at module scope; every consumer imports the same
 *  accessor/setter pair rather than threading props through the shell. */

import { createSignal } from "solid-js";
import { setChromeDrawerOpen } from "../useChromeDrawer";
import { isDesktop } from "../useMobile";

export const [settingsOpen, setSettingsOpen] = createSignal(false);

/** Open the settings view from anywhere (the `#/settings` deep link). On touch
 *  the popover lives inside the pull-down chrome drawer, so open that first.
 *  On desktop the drawer has no consumer — and because the layout is reactive
 *  (a later resize mounts the touch chrome), we must NOT write its state there,
 *  or the drawer would mount already-open after crossing into a touch layout.
 *  So branch on the current layout: touch opens the drawer, desktop does not.
 *  One canonical action so a caller can't open the popover without the surface
 *  that hosts it. */
export function openSettings(): void {
  if (!isDesktop()) setChromeDrawerOpen(true);
  setSettingsOpen(true);
}
