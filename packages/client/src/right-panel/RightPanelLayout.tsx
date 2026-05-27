/** RightPanelLayout — picks the host that surfaces the right panel.
 *
 *  Two hosts, one content subtree:
 *  - Desktop (`DesktopResizableHost`): `@corvu/resizable` horizontal split.
 *    Visibility is the persisted `preferences.rightPanel.collapsed` bit;
 *    `sizes=[1,0]` keeps the handle in the DOM when collapsed.
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
import Resizable from "@corvu/resizable";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, createEffect, type JSX, on, Show } from "solid-js";
import { useCanvasViewport } from "../canvas/viewport/useCanvasViewport";
import { useViewPosture } from "../canvas/useViewPosture";
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

const DesktopResizableHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  const viewport = useCanvasViewport();

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

  return (
    <div class="flex-1 min-h-0 min-w-0 flex overflow-hidden">
      <Resizable
        orientation="horizontal"
        sizes={
          rightPanel.collapsed()
            ? [1, 0]
            : [1 - rightPanel.panelSize(), rightPanel.panelSize()]
        }
        onSizesChange={(sizes) => {
          if (sizes[1] !== undefined) rightPanel.setPanelSize(sizes[1]);
        }}
        class="flex-1 min-h-0 overflow-hidden"
      >
        <Resizable.Panel
          as="div"
          class={`min-w-0 min-h-0 flex ${props.contentClass ?? ""}`}
          minSize={0.3}
        >
          {props.children}
        </Resizable.Panel>
        <Show when={!rightPanel.collapsed()}>
          <Resizable.Handle
            data-testid="right-panel-handle"
            class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
            classList={{
              // Maximized (panel is flush at the pane boundary): the
              // drag hot-zone straddles the boundary as a thin strip.
              "before:-left-1 before:w-2": posture.maximized(),
              // Floating (panel sits 1rem inside the pane via the
              // host's `p-4`): expand the hot-zone to cover the entire
              // inset gap so the user grabs what looks like the
              // panel's left edge, not the invisible pane boundary
              // 16px to its left.
              "before:left-0 before:w-4": !posture.maximized(),
            }}
            aria-label="Resize inspector panel"
          />
        </Show>
        <Resizable.Panel
          as="div"
          // `p-4` + `canvas-grid-bg` (when floating) make the inset
          // gap a transparent-into-the-canvas region — the same grid
          // pattern the Dock floats over on the canvas pane extends
          // through this pane too, so the floating right card visibly
          // sits *on* the canvas instead of inside a separate gray
          // region. The card itself stays opaque via `bg-surface-0`,
          // so its rounded chrome + shadow read clearly against the
          // grid backdrop. `overflow-hidden` stays — the visible
          // portion of the card's shadow lives inside the `p-4` inset
          // anyway.
          //
          // The `style` block synchronises this pane's grid background
          // with the canvas pane's pan/zoom-driven grid (sourced from
          // the singleton `useCanvasViewport`). Without sync, each
          // pane drew its grid from its own element origin and the
          // lines didn't align at the Resizable handle — the user saw
          // it as "a 2nd canvas" next to the real one. With sync,
          // both panes share the same background-position and -size,
          // so the grid reads as one continuous surface that both
          // panes happen to expose.
          class="min-w-0 min-h-0 overflow-hidden"
          classList={{
            "p-4 canvas-grid-bg": !posture.maximized(),
          }}
          style={
            !posture.maximized()
              ? {
                  "background-position": viewport.gridBgPosition(),
                  "background-size": viewport.gridBgSize(),
                }
              : undefined
          }
          minSize={0}
        >
          {/* Render unconditionally so CodeTab's selectedPath signal and
           *  Pierre's tree expansion survive collapse — Resizable already
           *  shrinks this panel to zero width via sizes=[1,0] above. An
           *  inner <Show> would unmount and discard that state. */}
          <RightPanel
            terminalId={props.terminalId}
            meta={props.meta}
            onToggle={rightPanel.togglePanel}
            themeName={props.themeName}
            onThemeClick={props.onThemeClick}
            visible={!rightPanel.collapsed()}
            floating={!posture.maximized()}
          />
        </Resizable.Panel>
      </Resizable>
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
      <DesktopResizableHost {...props} />
    </Show>
  );
};

export default RightPanelLayout;
