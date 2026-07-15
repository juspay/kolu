/** The mobile pull-down chrome drawer's open state, hoisted to a module
 *  singleton (per `.claude/rules/solidjs.md` — state per domain) so an
 *  out-of-band opener can raise it. On touch, the settings popover's trigger
 *  lives INSIDE this drawer (`MobileChromeSheet`), so a `#/settings` deep link
 *  must open the drawer before the popover has anything to anchor to.
 *
 *  Only `MobilePullChrome` renders when the drawer state matters (the
 *  `!isDesktop()` gate), so setting this on desktop is a harmless no-op — no
 *  `isDesktop` branch is needed at the call site. */

import { createSignal } from "solid-js";

export const [chromeDrawerOpen, setChromeDrawerOpen] = createSignal(false);
