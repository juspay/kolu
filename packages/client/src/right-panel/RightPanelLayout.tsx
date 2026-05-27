/** RightPanelLayout — picks the host that surfaces the right panel.
 *
 *  Two hosts, one content subtree:
 *  - Desktop (`DesktopHost`): mirrors the dock's posture pairing. In tiled
 *    canvas mode the panel floats as a rounded card anchored top-right
 *    over the canvas grid; in maximized-tile mode it collapses to a flush
 *    right sidebar with a hard separator and the canvas reflows beside
 *    it. Visibility is the persisted `preferences.rightPanel.collapsed`
 *    bit; width comes from the persisted `preferences.rightPanel.size`
 *    fraction. A single `<aside>` swaps classList on posture — no DOM
 *    remount, so CodeTab's local Pierre tree state survives both the
 *    collapse toggle and the posture flip.
 *  - Mobile (`MobileDrawerHost`): `@corvu/drawer side="bottom"`. Visibility
 *    is the session-local `useRightPanel.drawerOpen()` signal — dismissing
 *    the drawer on a phone is not the same volatility as toggling the
 *    desktop chrome preference (see `useRightPanel.ts` header).
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
import {
  type Component,
  createEffect,
  createSignal,
  type JSX,
  on,
  Show,
} from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";
import { capturePointerGesture } from "../canvas/viewport/capturePointerGesture";
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

const DesktopHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  const [containerEl, setContainerEl] = createSignal<HTMLDivElement>();

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

  // Pointer-driven drag handle on the panel's left edge. Wiring + teardown
  // delegate to `capturePointerGesture` — the same primitive tile-resize,
  // canvas pan, and minimap drag use — so future changes to gesture
  // semantics (cursor handling, cancel keys, escape-to-revert) land once.
  // Container width is read on `pointerdown` (not tracked reactively) so
  // the gesture doesn't pay an observer subscription for the steady state.
  const onResizeStart = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = containerEl();
    if (!container) return;
    const cw = container.getBoundingClientRect().width;
    if (cw <= 0) return;
    const startX = e.clientX;
    const startSize = rightPanel.panelSize();
    capturePointerGesture(
      {
        onMove: (ev) => {
          const delta = (startX - ev.clientX) / cw;
          rightPanel.setPanelSize(startSize + delta);
        },
        onEnd: () => {},
      },
      new AbortController(),
    );
  };

  // Width rendered as percentage so first paint matches the persisted
  // size with no observer-driven flash. Maximized+collapsed gets an
  // explicit 0px so the flex sibling fully releases its share to the
  // canvas; tiled+collapsed uses `hidden` instead (see classList).
  const panelWidthStyle = () => {
    if (rightPanel.collapsed() && posture.maximized()) return "0px";
    return `${rightPanel.panelSize() * 100}%`;
  };

  return (
    <div
      ref={setContainerEl}
      class="flex-1 min-h-0 min-w-0 flex overflow-hidden relative"
    >
      <div class={`flex-1 min-w-0 min-h-0 flex ${props.contentClass ?? ""}`}>
        {props.children}
      </div>
      <aside
        data-testid="right-panel-shell"
        data-maximized={posture.maximized() ? "" : undefined}
        data-collapsed={rightPanel.collapsed() ? "" : undefined}
        class="bg-surface-0 flex overflow-hidden"
        classList={{
          // Tiled: float over the canvas grid as a rounded card, mirroring
          // the dock's tiled-mode treatment on the opposite edge — same
          // `z-30` and `top-20` so both surfaces sit on the same continuous
          // canvas grid. Vertical extent diverges intentionally: the dock
          // uses `max-h-[calc(100vh-22rem)]` (shrink-to-content for finite
          // row lists), the panel uses `bottom-4` because the Code tab's
          // file tree benefits from every available pixel.
          "absolute z-30 top-20 right-4 bottom-4 rounded-2xl shadow-2xl shadow-black/40":
            !posture.maximized() && !rightPanel.collapsed(),
          // Maximized: real flex sibling of the canvas — flush right
          // sidebar with a hard separator on its left edge. Canvas
          // reflows into the remaining width via its `flex-1`.
          "relative shrink-0 h-full border-l border-edge": posture.maximized(),
          // Tiled + collapsed: drop out of layout. Component stays
          // mounted (CodeTab's Pierre tree expansion survives) but
          // the floating shadow doesn't leak as a visual sliver.
          hidden: !posture.maximized() && rightPanel.collapsed(),
        }}
        style={{ width: panelWidthStyle() }}
      >
        <Show when={!rightPanel.collapsed()}>
          {/* Pointer-only drag affordance. The prior Corvu
           *  `Resizable.Handle` carried `role="separator"` but didn't
           *  wire keyboard arrow-key resize, so taking the role here
           *  would promise a11y behaviour the gesture surface doesn't
           *  deliver. Kept as a styled hit-zone with `title` for hover
           *  discovery — screen-reader users have no productive
           *  interaction here regardless. */}
          <div
            data-testid="right-panel-handle"
            title="Resize inspector panel"
            class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors before:z-10"
            onPointerDown={onResizeStart}
          />
        </Show>
        <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
          <RightPanel
            terminalId={props.terminalId}
            meta={props.meta}
            onToggle={rightPanel.togglePanel}
            themeName={props.themeName}
            onThemeClick={props.onThemeClick}
            visible={!rightPanel.collapsed()}
          />
        </div>
      </aside>
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
      <DesktopHost {...props} />
    </Show>
  );
};

export default RightPanelLayout;
