/** MobileTileView — single fullscreen tile with swipe navigation.
 *
 *  On mobile the canvas (pan/zoom) and pill tree are disabled per #622.
 *  The active terminal fills the viewport; swipe-left/right cycles between
 *  terminals in pill-tree order. A slim title row anchored at the top
 *  shows the active terminal's identity (repo · branch + agent indicator)
 *  so the user always knows where they are without the canvas chrome. */

import { type Component, For, Show, createSignal, type JSX } from "solid-js";
import type { TerminalId } from "kolu-common";
import type { TerminalDisplayInfo } from "./terminal/terminalDisplay";
import TerminalMeta from "./terminal/TerminalMeta";

/** Minimum horizontal travel (px) before a swipe commits to a tile change. */
const SWIPE_THRESHOLD = 60;
/** Vertical drift cap — if the user moved more vertically than horizontally,
 *  treat the gesture as a scroll, not a swipe. */
const VERTICAL_TOLERANCE_RATIO = 0.7;

const MobileTileView: Component<{
  /** Pill-tree-ordered ids — same source as the desktop pill tree, so swipe
   *  order matches what the user would see if they switched to desktop. */
  orderedIds: TerminalId[];
  activeId: TerminalId | null;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  setActiveId: (id: TerminalId) => void;
  /** Render the actual terminal body (xterm + sub-panel + search bar). */
  renderBody: (id: TerminalId, visible: () => boolean) => JSX.Element;
  /** Soft-keyboard helper bar (Esc, Tab, arrows, etc.). */
  bottomBar?: JSX.Element;
}> = (props) => {
  const [touchStart, setTouchStart] = createSignal<{
    x: number;
    y: number;
  } | null>(null);

  function navigate(direction: 1 | -1) {
    const ids = props.orderedIds;
    if (ids.length < 2 || props.activeId === null) return;
    const idx = ids.indexOf(props.activeId);
    if (idx === -1) return;
    const next = (idx + direction + ids.length) % ids.length;
    const target = ids[next];
    if (target) props.setActiveId(target);
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

  const activeInfo = () =>
    props.activeId !== null ? props.getDisplayInfo(props.activeId) : undefined;

  return (
    <div
      data-testid="mobile-tile-view"
      class="flex-1 min-h-0 flex flex-col"
      // Listen for swipes on the wrapper so xterm's own pointer handling
      // is unaffected — touchstart bubbles even when xterm consumes pointer
      // events internally.
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Slim identity row — repo · branch + agent indicator. The minimal
       *  header carries no per-terminal state on mobile, so this row
       *  stands in for the per-tile chrome that desktop tiles wear. */}
      <Show when={activeInfo()}>
        {(info) => (
          <div
            data-testid="mobile-tile-titlebar"
            class="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-edge bg-surface-1"
          >
            <div class="flex-1 min-w-0">
              <TerminalMeta info={info()} />
            </div>
          </div>
        )}
      </Show>
      {/* Body container — relative so per-terminal absolutely-positioned
       *  search overlays anchor here, not the dvh root. */}
      <div class="flex-1 min-h-0 relative overflow-hidden">
        <For each={props.orderedIds}>
          {(id) => {
            const visible = () => props.activeId === id;
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
  );
};

export default MobileTileView;
