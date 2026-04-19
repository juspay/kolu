/** MobileTileView — single fullscreen tile with swipe navigation.
 *
 *  On mobile the canvas (pan/zoom) and the desktop pill tree are
 *  disabled per #622. The active terminal fills the viewport; swipe-
 *  left/right cycles between terminals in pill-tree order. A pull-handle
 *  row at the top is always visible (drag-bar + identity + connection
 *  dot); tapping it opens `MobileChromeSheet`, which mirrors the desktop
 *  ChromeBar for touch — logo, vertical pill list, controls. */

import { type Component, For, Show, createSignal, type JSX } from "solid-js";
import Drawer from "@corvu/drawer";
import type { TerminalId } from "kolu-common";
import type { PillRepoGroup } from "./canvas/pillTreeOrder";
import type { WsStatus } from "./rpc/rpc";
import TerminalMeta from "./terminal/TerminalMeta";
import MobileChromeSheet from "./MobileChromeSheet";
import { useTerminalStore } from "./terminal/useTerminalStore";

/** Minimum horizontal travel (px) before a swipe commits to a tile change. */
const SWIPE_THRESHOLD = 60;
/** Vertical drift cap — if the user moved more vertically than horizontally,
 *  treat the gesture as a scroll, not a swipe. */
const VERTICAL_TOLERANCE_RATIO = 0.7;

const MobileTileView: Component<{
  /** Pill-tree-ordered ids — same source as the desktop pill tree, so swipe
   *  order matches what the user would see if they switched to desktop. */
  orderedIds: TerminalId[];
  /** Chrome sheet props. Passed through to MobileChromeSheet when the
   *  user opens the drawer. */
  groups: PillRepoGroup[];
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
  const [sheetOpen, setSheetOpen] = createSignal(false);

  function navigate(direction: 1 | -1) {
    const ids = props.orderedIds;
    const active = store.activeId();
    if (ids.length < 2 || active === null) return;
    const idx = ids.indexOf(active);
    if (idx === -1) return;
    const next = (idx + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target) store.setActiveId(target);
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
    <Drawer side="top" open={sheetOpen()} onOpenChange={setSheetOpen}>
      <div
        data-testid="mobile-tile-view"
        class="flex-1 min-h-0 flex flex-col relative"
        // Listen for swipes on the wrapper so xterm's own pointer handling
        // is unaffected — touchstart bubbles even when xterm consumes pointer
        // events internally.
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Pull-handle row — drag-bar + compact identity strip. Tap to
         *  open the drawer (Corvu's Trigger). `onTouchStart`
         *  stopPropagation keeps the wrapper's horizontal-swipe handler
         *  from treating a tap on the handle as a tile-cycle gesture. */}
        <Drawer.Trigger
          data-testid="mobile-pull-handle"
          class="flex flex-col items-center gap-1 px-3 py-1.5 shrink-0 border-b border-edge bg-surface-1 cursor-pointer active:bg-surface-2 transition-colors"
          aria-label="Open navigation"
          onTouchStart={(e: TouchEvent) => e.stopPropagation()}
        >
          <span class="w-10 h-1 rounded-full bg-fg-3/40" aria-hidden="true" />
          <div class="flex items-center gap-2 w-full">
            <Show
              when={activeInfo()}
              fallback={<span class="text-sm text-fg-2">kolu</span>}
            >
              {(info) => (
                <div data-testid="mobile-tile-titlebar" class="flex-1 min-w-0">
                  <TerminalMeta info={info()} mode="compact" />
                </div>
              )}
            </Show>
          </div>
        </Drawer.Trigger>

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
            groups={props.groups}
            onSelect={store.setActiveId}
            onClose={() => setSheetOpen(false)}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  );
};

export default MobileTileView;
