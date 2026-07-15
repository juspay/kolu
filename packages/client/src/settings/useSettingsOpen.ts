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

export const [settingsOpen, setSettingsOpen] = createSignal(false);
