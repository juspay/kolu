/** The mobile pull-down chrome drawer's open state, hoisted to a module
 *  singleton (per `.claude/rules/solidjs.md` — state per domain) so an
 *  out-of-band opener can raise it. On touch, the settings popover's trigger
 *  lives INSIDE this drawer (`MobileChromeSheet`), so a `#/settings` deep link
 *  must open the drawer before the popover has anything to anchor to.
 *
 *  `MobilePullChrome` (touch only) is the sole renderer of this state. But it is
 *  NOT safe to set on desktop: the layout is reactive, so a value written while
 *  on desktop persists and would leave the drawer mounted already-open after a
 *  resize into a touch layout. So a call site that can outlive a layout change
 *  MUST gate the write on the current layout — `openSettings` (its one caller)
 *  branches on `!isDesktop()` for exactly this reason (pinned by the F10
 *  regression test in `useSettingsOpen.test.ts`). */

import { createSignal } from "solid-js";

export const [chromeDrawerOpen, setChromeDrawerOpen] = createSignal(false);
