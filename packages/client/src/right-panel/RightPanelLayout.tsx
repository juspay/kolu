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
            // `z-50` lifts the handle above the maximized-tile overlay
            // (`z-40` in `TerminalCanvas`) so the user can still drag
            // the panel edge to resize when a tile is maximized.
            class="shrink-0 w-0 relative z-50 before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
            aria-label="Resize inspector panel"
          />
        </Show>
        <Resizable.Panel
          as="div"
          class="min-w-0 min-h-0 overflow-hidden"
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
