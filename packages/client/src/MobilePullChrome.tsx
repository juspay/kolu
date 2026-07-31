/** MobilePullChrome — the touch layout's persistent top pull-down chrome: the
 *  always-visible pull-handle and the chrome sheet drawer it opens (global
 *  controls + the host row).
 *
 *  This is the mobile analog of the desktop `ChromeBar`, and it lives at the
 *  SAME altitude — a sibling ABOVE the canvas `<Switch>` in `App.tsx`, present
 *  in EVERY canvas mode. It used to live inside `MobileTileView`, which only
 *  renders in the `workspace` mode; that trapped the host row there, so
 *  switching to a host that was still `connecting`/`warming` (or a `down` /
 *  `hostFailed` host) replaced the whole tile view with a full-screen status
 *  canvas and took the pull-handle with it — leaving a phone user with **no way
 *  to reach the host row and switch away**. Hoisting the chrome up here fixes
 *  that class uniformly: the handle is reachable while a host comes up, fails,
 *  or has zero terminals, exactly as the desktop host strip always is.
 *
 *  The handle shows the ACTIVE terminal's compact meta when there is one (the
 *  `workspace` case) and a plain "kolu" otherwise — so a not-yet-connected host
 *  reads cleanly without a stale terminal title. */

import Drawer from "@corvu/drawer";
import { type Component, Show } from "solid-js";
import MobileChromeSheet from "./MobileChromeSheet";
import type { WsStatus } from "./rpc/rpc";
import { TerminalMetaCompact } from "./terminal/TerminalMeta";
import { pairDisplayRow } from "./terminal/terminalDisplay";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { withKeyboardDismiss } from "./ui/dismissSoftKeyboard";
import { clientStale, StaleBadge } from "./ui/StaleBadge";
import {
  chromeDrawerOpen as chromeOpen,
  setChromeDrawerOpen as setChromeOpen,
} from "./useChromeDrawer";

/** Minimum downward pull (px) on the chrome handle before the drawer commits to
 *  opening. Sits above the browser's tap-slop (≈10px) and below a casual finger
 *  jitter so a real tap still opens via the click handler. */
const PULL_OPEN_THRESHOLD = 24;
/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]`, but on the mouse-click open
 *  path it reads the signal before the default attaches and trips a
 *  reactive-ordering bug (#977). Passing the value explicitly sidesteps it;
 *  touch-driven opens hit a different code path and never trip the bug. Delete
 *  on the Corvu upgrade that fixes #977. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const MobilePullChrome: Component<{
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
}> = (props) => {
  const store = useTerminalStore();
  // The open state is a module singleton (`useChromeDrawer`, imported aliased
  // above) so the `#/settings` deep link can raise the drawer that hosts the
  // settings popover on touch.
  // Every dismiss path — backdrop tap, drag-to-close (both via Corvu's
  // onOpenChange) and the in-sheet buttons (`onClose`, routed through
  // `handler(false)`) — funnels through this so the soft keyboard never lingers
  // on a touch device after the drawer goes away.
  const onChromeOpenChange = withKeyboardDismiss(setChromeOpen);
  // Pull-handle drag state. Not reactive — only the touch handlers read it.
  let pullStartY: number | null = null;

  // The active terminal's display row — the slow decorations paired with the
  // live record, gated both-present through the shared `pairDisplayRow`. Reads
  // `activeId()` once and gates once, so `TerminalMetaCompact` gets a coherent
  // (info, meta) pair (no info-present/meta-absent skew) exactly as the desktop
  // header does.
  const activeRow = () => {
    const id = store.activeId();
    return id !== null
      ? pairDisplayRow(store.getDisplayInfo(id), store.getMetadata(id))
      : null;
  };

  return (
    <>
      {/* Top pull-handle — opens the chrome drawer on tap or downward-drag past
       *  `PULL_OPEN_THRESHOLD`. Always present on the touch layout, whatever the
       *  canvas is showing. */}
      <button
        type="button"
        data-testid="mobile-pull-handle"
        class="flex flex-col items-center gap-1 px-3 py-1.5 shrink-0 border-b border-edge bg-surface-1 cursor-pointer active:bg-surface-2 transition-colors"
        aria-label="Open navigation"
        onClick={() => setChromeOpen(true)}
        onTouchStart={(e: TouchEvent) => {
          e.stopPropagation();
          const t = e.touches[0];
          pullStartY = t ? t.clientY : null;
        }}
        onTouchMove={(e: TouchEvent) => {
          if (pullStartY === null || chromeOpen()) return;
          const t = e.touches[0];
          if (!t) return;
          if (t.clientY - pullStartY >= PULL_OPEN_THRESHOLD) {
            // preventDefault suppresses the synthesized click that would
            // otherwise re-toggle the drawer closed.
            e.preventDefault();
            setChromeOpen(true);
            pullStartY = null;
          }
        }}
        onTouchEnd={() => {
          pullStartY = null;
        }}
      >
        {/* Grip pill — sized to mirror the left dock handle's grab bar
         *  (`h-16 w-2`, a 64×8 px footprint) so both edges advertise an equally
         *  large drag affordance, just rotated 90°. */}
        <span class="w-16 h-2 rounded-full bg-fg-3/40" aria-hidden="true" />
        <div class="flex items-center gap-2 w-full">
          <Show
            when={activeRow()}
            fallback={<span class="text-sm text-fg-2">kolu</span>}
          >
            {(row) => (
              <div data-testid="mobile-tile-titlebar" class="flex-1 min-w-0">
                <TerminalMetaCompact info={row().info} meta={row().meta} />
              </div>
            )}
          </Show>
          {/* At-a-glance "client out of sync with server" catch — the mobile
           *  echo of the desktop rail's `≠ srv` badge, on the always-visible
           *  handle so drift is caught without opening the sheet (which carries
           *  the Reload action). */}
          <Show when={clientStale()}>
            <div data-testid="mobile-stale-badge" class="ml-auto shrink-0">
              <StaleBadge />
            </div>
          </Show>
        </div>
      </button>

      {/* Chrome (top pull-down) drawer — global controls + the host row.
       *  Carries `CORVU_SNAP_WORKAROUND` — same #977 sidestep as the dock drawer
       *  in `MobileTileView`, since both open via mouse-click. */}
      <Drawer
        side="top"
        open={chromeOpen()}
        onOpenChange={onChromeOpenChange}
        snapPoints={CORVU_SNAP_WORKAROUND}
        // Keep Corvu from restoring focus to the terminal textarea on close;
        // `onChromeOpenChange` then actively blurs it. restoreFocus={false}
        // stops Corvu re-summoning the keyboard, and the blur drops a keyboard
        // iOS left lingering while the drawer was open. See `dismissSoftKeyboard`.
        restoreFocus={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="mobile-chrome-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content class="fixed top-0 left-0 right-0 z-50 bg-surface-1 border-b border-edge shadow-xl max-h-[70vh] overflow-y-auto">
            <MobileChromeSheet
              status={props.status}
              appTitle={props.appTitle}
              onOpenPalette={props.onOpenPalette}
              onClose={() => onChromeOpenChange(false)}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

export default MobilePullChrome;
