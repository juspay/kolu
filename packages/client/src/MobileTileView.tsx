/** MobileTileView — single fullscreen tile with swipe navigation.
 *
 *  On mobile the canvas (pan/zoom) and the desktop dock are
 *  disabled per #622. The active terminal fills the viewport; swipe-
 *  left/right cycles between terminals in workspace-switcher order.
 *
 *  Two chrome drawers mirror the desktop split (#903):
 *  - **Top pull-down** (`MobileChromeSheet`): global controls — palette,
 *    settings, inspector toggle. Trigger is the always-visible
 *    pull-handle row at the top of the terminal.
 *  - **Left swipe** (`MobileDockDrawer`): live-terminal navigator. The
 *    mobile mirror of the desktop dock; trigger is a thin
 *    handle pinned to the left edge.
 *
 *  Both Corvu `Drawer`s live as siblings (not nested) so each has its
 *  own clean context — nesting put the chrome trigger inside the dock
 *  drawer's context, breaking the chrome-tap-to-open path. Plain
 *  buttons drive `open` state setters directly; the chrome handle
 *  keeps its drag-down-to-open behavior via a manual touchmove
 *  handler. */

import Drawer from "@corvu/drawer";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal, For, type JSX, Show } from "solid-js";
import MobileDockDrawer from "./canvas/dock/MobileDockDrawer";
import MobileChromeSheet from "./MobileChromeSheet";
import type { WsStatus } from "./rpc/rpc";
import { TerminalMetaCompact } from "./terminal/TerminalMeta";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { withKeyboardDismiss } from "./ui/dismissSoftKeyboard";

/** Minimum horizontal travel (px) before a swipe commits to a tile change. */
const SWIPE_THRESHOLD = 60;
/** Vertical drift cap — if the user moved more vertically than horizontally,
 *  treat the gesture as a scroll, not a swipe. */
const VERTICAL_TOLERANCE_RATIO = 0.7;
/** Minimum downward pull (px) on the chrome handle before the drawer
 *  commits to opening. Sits above the browser's tap-slop (≈10px) and
 *  below a casual finger jitter so a real tap still opens via the
 *  click handler. */
const PULL_OPEN_THRESHOLD = 24;
/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]`, but on the mouse-click
 *  open path it reads the signal before the default attaches and trips a
 *  reactive-ordering bug (#977). Passing the value explicitly sidesteps it;
 *  touch-driven opens hit a different code path and never trip the bug.
 *  Shared by both drawers below — delete on the Corvu upgrade that fixes
 *  #977. (Orthogonal to `restoreFocus`, which is a soft-keyboard policy, not
 *  a library workaround, and so stays inline per-drawer.) */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const MobileTileView: Component<{
  /** Workspace-switcher-ordered ids — same source as the desktop dock, so
   *  swipe order matches what the user would see if they switched to
   *  desktop. */
  orderedIds: TerminalId[];
  status: WsStatus;
  appTitle: string;
  onOpenPalette: () => void;
  /** Render the actual terminal body (xterm + sub-panel + search bar). */
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  /** Soft-keyboard helper bar (Esc, Tab, arrows, etc.). */
  bottomBar?: JSX.Element;
}> = (props) => {
  const store = useTerminalStore();
  const [touchStart, setTouchStart] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [chromeOpen, setChromeOpen] = createSignal(false);
  const [dockOpen, setDockOpen] = createSignal(false);
  // Every dismiss path — backdrop tap, drag-to-close (both via Corvu's
  // onOpenChange) and the in-sheet buttons (`onClose`, routed through
  // `handler(false)`) — funnels through these so the soft keyboard never
  // lingers on a touch device after the drawer goes away.
  const onChromeOpenChange = withKeyboardDismiss(setChromeOpen);
  const onDockOpenChange = withKeyboardDismiss(setDockOpen);
  // Pull-handle drag state for the chrome (top) drawer. Not reactive —
  // only the touch handlers read it.
  let pullStartY: number | null = null;

  function navigate(direction: 1 | -1) {
    const ids = props.orderedIds;
    const active = store.activeId();
    if (ids.length < 2 || active === null) return;
    const idx = ids.indexOf(active);
    if (idx === -1) return;
    const next = (idx + direction + ids.length) % ids.length;
    const target = ids[next];
    // Mobile: there is no canvas to pan — `setActiveSilently` is correct.
    if (target) store.setActiveSilently(target);
  }

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    setTouchStart({ x: t.clientX, y: t.clientY });
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touchStart();
    setTouchStart(null);
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_TOLERANCE_RATIO) return;
    navigate(dx < 0 ? 1 : -1);
  }

  const activeInfo = () => {
    const id = store.activeId();
    return id !== null ? store.getDisplayInfo(id) : undefined;
  };

  return (
    <>
      <div
        data-testid="mobile-tile-view"
        class="flex-1 min-h-0 flex flex-col relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Top pull-handle — opens the chrome drawer on tap or
         *  downward-drag past `PULL_OPEN_THRESHOLD`. */}
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
              // preventDefault suppresses the synthesized click that
              // would otherwise re-toggle the drawer closed.
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
           *  (`h-16 w-2`, a 64×8 px footprint) so both edges advertise an
           *  equally large drag affordance, just rotated 90°. */}
          <span class="w-16 h-2 rounded-full bg-fg-3/40" aria-hidden="true" />
          <div class="flex items-center gap-2 w-full">
            <Show
              when={activeInfo()}
              fallback={<span class="text-sm text-fg-2">kolu</span>}
            >
              {(info) => (
                <div data-testid="mobile-tile-titlebar" class="flex-1 min-w-0">
                  <TerminalMetaCompact info={info()} />
                </div>
              )}
            </Show>
          </div>
        </button>

        {/* Left-edge dock handle — opens the dock drawer on tap. The button
         *  is a 32px-wide transparent hit target (clears the WCAG 2.2 24px
         *  touch-target floor) wrapping an 8px visible bar, so the grab zone
         *  is comfortable on a phone without a chunky edge intrusion. */}
        <button
          type="button"
          data-testid="mobile-dock-handle"
          class="group absolute top-1/2 left-0 -translate-y-1/2 z-10 flex h-16 w-8 items-center justify-start cursor-pointer"
          aria-label="Open dock"
          onClick={() => setDockOpen(true)}
          // Don't let the wrapper's horizontal-swipe handler claim
          // an edge-grab as a tile cycle gesture.
          onTouchStart={(e: TouchEvent) => e.stopPropagation()}
        >
          <span
            aria-hidden="true"
            class="h-16 w-2 rounded-r bg-fg-3/30 transition-colors group-active:bg-fg-3/60"
          />
        </button>

        {/* Body container — relative so per-terminal absolutely-positioned
         *  search overlays anchor here, not the dvh root. */}
        <div class="flex-1 min-h-0 relative overflow-hidden">
          <For each={props.orderedIds}>
            {(id) => {
              const visible = () => store.activeId() === id;
              return (
                <div
                  class="absolute inset-0 flex flex-col"
                  classList={{ hidden: !visible() }}
                >
                  {props.renderBody(id, visible)}
                </div>
              );
            }}
          </For>
        </div>
        {props.bottomBar}
      </div>

      {/* Chrome (top pull-down) drawer — global controls.
       *  Carries `CORVU_SNAP_WORKAROUND` — same #977 sidestep as the dock
       *  drawer below, since both open via mouse-click. */}
      <Drawer
        side="top"
        open={chromeOpen()}
        onOpenChange={onChromeOpenChange}
        snapPoints={CORVU_SNAP_WORKAROUND}
        // Keep Corvu from restoring focus to the terminal textarea on close;
        // `onChromeOpenChange` then actively blurs it. The two are
        // complementary: restoreFocus={false} stops Corvu re-summoning the
        // keyboard, and the blur drops a keyboard iOS left lingering while the
        // drawer was open (focus-trapping into the sheet does not reliably blur
        // the field underneath). See `dismissSoftKeyboard`.
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

      {/* Dock (left swipe) drawer — terminal navigator.
       *  Carries `CORVU_SNAP_WORKAROUND` for the same #977 reason as the
       *  chrome drawer above. */}
      <Drawer
        side="left"
        open={dockOpen()}
        onOpenChange={onDockOpenChange}
        snapPoints={CORVU_SNAP_WORKAROUND}
        // See the chrome drawer above: restoreFocus={false} keeps Corvu from
        // re-summoning the keyboard, `onDockOpenChange` blurs the field to drop
        // a keyboard left lingering. Covers both dismiss paths — backdrop tap
        // (Corvu's onOpenChange) and selecting a terminal row (onClose below).
        restoreFocus={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="mobile-dock-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content class="fixed top-0 left-0 bottom-0 z-50 w-[78vw] max-w-[20rem] bg-surface-1 border-r border-edge shadow-xl">
            <MobileDockDrawer
              onSelect={store.setActiveSilently}
              onClose={() => onDockOpenChange(false)}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

export default MobileTileView;
