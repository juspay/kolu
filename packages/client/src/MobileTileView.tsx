/** MobileTileView — the touch single-tile pane with swipe navigation.
 *
 *  Used directly as the phone layout, and reused by `CompactTileView` as the
 *  compact (tablet / Z Fold unfolded) layout's terminal pane — there with
 *  `hideDockDrawer`, since the compact layout supplies its own persistent dock
 *  rail in place of the edge-drawer below. The active terminal fills the pane;
 *  swipe-left/right cycles between terminals in workspace-switcher order. On the
 *  phone the canvas (pan/zoom) and the desktop dock are disabled per #622.
 *
 *  Chrome drawers mirror the desktop split (#903):
 *  - **Top pull-down** (`MobilePullChrome` → `MobileChromeSheet`): global
 *    controls + the host row. This lives ABOVE the canvas `<Switch>` in
 *    `App.tsx` — NOT here — so it stays reachable in every canvas mode (a host
 *    that is connecting/warming/down would otherwise replace this whole tile
 *    view and take the pull-handle with it). This component owns only the
 *    workspace tile pane.
 *  - **Left swipe**: the live-terminal navigator — the `DockList` (shared with
 *    the compact rail) in a left edge-drawer; trigger is a thin handle pinned to
 *    the left edge. Suppressed under `hideDockDrawer`.
 *
 *  The dock `Drawer`'s plain button drives its `open` setter directly. */

import Drawer from "@corvu/drawer";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createSignal, For, type JSX, Show } from "solid-js";
import { DockList } from "./canvas/dock/DockList";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { withKeyboardDismiss } from "./ui/dismissSoftKeyboard";

/** Minimum horizontal travel (px) before a swipe commits to a tile change. */
const SWIPE_THRESHOLD = 60;
/** Vertical drift cap — if the user moved more vertically than horizontally,
 *  treat the gesture as a scroll, not a swipe. */
const VERTICAL_TOLERANCE_RATIO = 0.7;
/** Corvu @0.2.4 defaults `snapPoints` to `[0, 1]`, but on the mouse-click
 *  open path it reads the signal before the default attaches and trips a
 *  reactive-ordering bug (#977). Passing the value explicitly sidesteps it;
 *  touch-driven opens hit a different code path and never trip the bug. Used by
 *  the dock drawer below (the chrome drawer moved to `MobilePullChrome`, which
 *  carries its own copy) — delete on the Corvu upgrade that fixes #977. */
const CORVU_SNAP_WORKAROUND: [number, number] = [0, 1];

const MobileTileView: Component<{
  /** Workspace-switcher-ordered ids — same source as the desktop dock, so
   *  swipe order matches what the user would see if they switched to
   *  desktop. */
  orderedIds: TerminalId[];
  /** Render the actual terminal body (xterm + sub-panel + search bar). */
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  /** Soft-keyboard helper bar (Esc, Tab, arrows, etc.). */
  bottomBar?: JSX.Element;
  /** Suppress the left-edge dock handle + swipe drawer. The compact layout
   *  (`CompactTileView`) mounts a *persistent* dock rail beside this tile, so
   *  the edge-drawer navigator would be a redundant second copy. The top chrome
   *  sheet and swipe-to-cycle stay; only the dock drawer is dropped. */
  hideDockDrawer?: boolean;
}> = (props) => {
  const store = useTerminalStore();
  const [touchStart, setTouchStart] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [dockOpen, setDockOpen] = createSignal(false);
  // The dock dismiss paths (backdrop tap, drag-to-close via Corvu's
  // onOpenChange, and selecting a terminal row) funnel through this so the soft
  // keyboard never lingers on a touch device after the drawer goes away.
  const onDockOpenChange = withKeyboardDismiss(setDockOpen);

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

  return (
    <>
      <div
        data-testid="mobile-tile-view"
        class="flex-1 min-h-0 flex flex-col relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Left-edge dock handle — opens the dock drawer on tap. The button
         *  is a 32px-wide transparent hit target (clears the WCAG 2.2 24px
         *  touch-target floor) wrapping an 8px visible bar, so the grab zone
         *  is comfortable on a phone without a chunky edge intrusion.
         *  Suppressed under `hideDockDrawer` — the compact layout shows a
         *  persistent dock rail instead. */}
        <Show when={!props.hideDockDrawer}>
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
        </Show>

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

      {/* Dock (left swipe) drawer — terminal navigator.
       *  Carries `CORVU_SNAP_WORKAROUND` for the same #977 reason as the chrome
       *  drawer (now in `MobilePullChrome`). Suppressed under `hideDockDrawer`
       *  (the compact layout's persistent rail replaces it). */}
      <Show when={!props.hideDockDrawer}>
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
              {/* The dock list, same `DockList` the compact rail mounts; the
               *  phone drawer's one addition is dismiss-on-select. */}
              <div data-testid="mobile-dock-sheet" class="flex flex-col h-full">
                <DockList
                  onSelect={(id) => {
                    store.setActiveSilently(id);
                    onDockOpenChange(false);
                  }}
                  onSubSelected={() => onDockOpenChange(false)}
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer>
      </Show>
    </>
  );
};

export default MobileTileView;
