/** RightPanelLayout — picks the host that surfaces the right panel.
 *
 *  Two hosts, one content subtree:
 *  - Desktop (`DesktopOverlayHost`): the canvas takes the full wrapper
 *    width and the right panel is an `absolute right-4 top-4 bottom-4`
 *    overlay on top of it. This is what lets the canvas grid (and any
 *    terminal tile sitting in the bottom-right) read continuously
 *    behind the floating card — a true sibling Resizable split made
 *    the right portion look like an empty "second canvas". The drag
 *    handle is now a custom pointer-event affair anchored to the
 *    panel's left edge.
 *  - Mobile (`MobileDrawerHost`): `@corvu/drawer side="bottom"`.
 *    Visibility is the session-local `useRightPanel.drawerOpen()`
 *    signal — dismissing the drawer on a phone is not the same
 *    volatility as toggling the desktop chrome preference (see
 *    `useRightPanel.ts` header).
 *
 *  Each host owns its own response to `pendingOpen` (the producer signal
 *  seeded by `openInCodeTab`): desktop calls `expandPanel`, mobile calls
 *  `setDrawerOpen(true)`. Splitting into sibling components makes
 *  `isMobile()` the *only* platform-dispatch site, instead of leaking it
 *  into a `createEffect(on(pendingOpen, …))` body where SolidJS would also
 *  track it implicitly as a reactive read.
 *
 *  Selection, mode, and tab kind share `useRightPanel` across hosts — a
 *  phone session that ends on `foo.html` reopens on desktop with
 *  `foo.html` already selected. */

import Drawer from "@corvu/drawer";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, createEffect, type JSX, on, Show } from "solid-js";
import { isMobile } from "../useMobile";
import { pendingOpen } from "./openInCodeTab";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

type HostProps = {
  children: JSX.Element;
  /** Active terminal id. Used by the Code tab's iframe-preview path to
   *  build the per-terminal file-serving URL. */
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
};

const MIN_PANEL_SIZE = 0.1;
const MAX_PANEL_SIZE = 0.7;

const DesktopOverlayHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();

  let wrapperRef: HTMLDivElement | undefined;

  // Producer arrivals (terminal `path:line` taps, comments-tray jumps)
  // uncollapse the side panel — visibility used to live inside
  // `openCodeAt`, but moving it here keeps the hook platform-free.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req) return;
        if (rightPanel.collapsed()) rightPanel.expandPanel();
      },
      { defer: true },
    ),
  );

  // Custom drag handle — captures pointer events on the wrapper while
  // the user is dragging the panel's left edge, so the drag is robust
  // against cursor leaving the 16px-wide hot-zone. Width is stored as
  // a fraction of the wrapper width to survive viewport resize.
  function onHandlePointerDown(e: PointerEvent) {
    e.preventDefault();
    if (!wrapperRef) return;
    const wrapperWidth = wrapperRef.getBoundingClientRect().width;
    if (wrapperWidth === 0) return;
    const startX = e.clientX;
    const startSize = rightPanel.panelSize();
    const onMove = (ev: PointerEvent) => {
      // Dragging *leftward* makes the panel wider — the panel grows
      // from the right edge into the canvas.
      const delta = (startX - ev.clientX) / wrapperWidth;
      const next = Math.max(
        MIN_PANEL_SIZE,
        Math.min(MAX_PANEL_SIZE, startSize + delta),
      );
      rightPanel.setPanelSize(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={wrapperRef}
      class={`flex-1 min-h-0 min-w-0 flex overflow-hidden relative ${props.contentClass ?? ""}`}
    >
      {/* Canvas takes the full wrapper width — the right panel overlays
       *  it instead of taking sibling flex space, so the canvas-grid
       *  (and any tile positioned in the bottom-right corner) reads
       *  continuously behind the floating card. */}
      {props.children}

      {/* Floating right panel, absolutely positioned on the right edge.
       *  Width is derived from `panelSize` × wrapper width; when
       *  collapsed the wrapper still mounts the panel (preserving
       *  CodeTab state per #818) but shrinks it to 0 width via the
       *  computed `width` style, mirroring the old Resizable
       *  `sizes=[1,0]` collapse contract. */}
      <div
        class="absolute z-10 right-0 top-0 bottom-0 transition-[width] duration-150 ease-out"
        classList={{
          // The `p-4` inset gives the floating card breathing room
          // against the underlying canvas, parallel to the Dock's
          // `top-20 left-4`. We keep it on regardless of maximize
          // posture so the right panel never disappears or snaps to
          // flush — the previous "flush in maximize" variant was
          // confusing because the panel went visually missing when
          // its `bg-surface-0` blended with the maximized terminal.
          "p-4": !rightPanel.collapsed(),
        }}
        style={{
          width: rightPanel.collapsed()
            ? "0px"
            : `${rightPanel.panelSize() * 100}%`,
        }}
        aria-hidden={rightPanel.collapsed()}
      >
        <RightPanel
          terminalId={props.terminalId}
          meta={props.meta}
          onToggle={rightPanel.togglePanel}
          themeName={props.themeName}
          onThemeClick={props.onThemeClick}
          visible={!rightPanel.collapsed()}
          floating={true}
        />
        {/* Drag handle — a thin strip in the `p-4` inset gap on the
         *  panel's outer-left edge, so the user is grabbing what looks
         *  like the card's left edge. Hidden when collapsed. */}
        <Show when={!rightPanel.collapsed()}>
          <div
            data-testid="right-panel-handle"
            class="absolute top-0 bottom-0 left-0 w-4 cursor-col-resize hover:bg-accent/30 transition-colors"
            onPointerDown={onHandlePointerDown}
          />
        </Show>
      </div>
    </div>
  );
};

const MobileDrawerHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();

  // Producer arrivals open the drawer. Setter is idempotent so repeated
  // taps on the same `path:line` don't fire spurious open transitions.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req) return;
        rightPanel.setDrawerOpen(true);
      },
      { defer: true },
    ),
  );

  return (
    <>
      <div
        class={`flex-1 min-h-0 min-w-0 flex overflow-hidden ${props.contentClass ?? ""}`}
      >
        {props.children}
      </div>
      <Drawer
        side="bottom"
        open={rightPanel.drawerOpen()}
        onOpenChange={rightPanel.setDrawerOpen}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="right-panel-drawer-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content class="fixed bottom-0 left-0 right-0 z-50 bg-surface-0 border-t border-edge shadow-xl h-[85vh] flex flex-col rounded-t-lg overflow-hidden">
            <div class="flex justify-center py-1.5 shrink-0" aria-hidden="true">
              <span class="w-10 h-1 rounded-full bg-fg-3/40" />
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <RightPanel
                terminalId={props.terminalId}
                meta={props.meta}
                onToggle={() => rightPanel.setDrawerOpen(false)}
                themeName={props.themeName}
                onThemeClick={props.onThemeClick}
                visible={rightPanel.drawerOpen()}
                // The drawer itself is already a floating surface
                // (`rounded-t-lg shadow-xl` above); an inner floating
                // card would double up the chrome.
                floating={false}
              />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

const RightPanelLayout: Component<HostProps> = (props) => {
  // The single platform-dispatch site. Each branch is its own component
  // so reactive ownership (effects, derived signals) sits inside the
  // active host only — switching viewports tears down the inactive
  // host's effects cleanly.
  return (
    <Show when={!isMobile()} fallback={<MobileDrawerHost {...props} />}>
      <DesktopOverlayHost {...props} />
    </Show>
  );
};

export default RightPanelLayout;
