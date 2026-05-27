/** RightPanelDrawer — mobile-only host for the right panel.
 *
 *  On mobile, the right panel hosts as a `@corvu/drawer side="bottom"`.
 *  Visibility is the session-local `useRightPanel.drawerOpen()` signal
 *  — dismissing the drawer on a phone is not the same volatility as
 *  toggling the desktop chrome preference (see `useRightPanel.ts`).
 *
 *  On desktop the right panel is rendered inline by `TerminalCanvas` as
 *  a sibling of the Dock in the outer flex container; it owns its own
 *  posture-aware chrome via `useViewPosture` and mirrors the Dock's
 *  tiled-float / maximized-flush pattern. The desktop pendingOpen→
 *  expandPanel effect lives in `App.tsx` so the mobile branch here
 *  only handles the drawer-open seam.
 *
 *  Selection, mode, and tab kind share `useRightPanel` across hosts —
 *  a phone session that ends on `foo.html` reopens on desktop with
 *  `foo.html` already selected. */

import Drawer from "@corvu/drawer";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, createEffect, type JSX, on } from "solid-js";
import { pendingOpen } from "./openInCodeTab";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

type HostProps = {
  children: JSX.Element;
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex-col" for the
   *  mobile column stack). */
  contentClass?: string;
};

const RightPanelDrawer: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();

  // Producer arrivals (terminal `path:line` taps, comments-tray jumps)
  // open the drawer. Setter is idempotent so repeated taps on the same
  // `path:line` don't fire spurious open transitions.
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
                // The drawer already provides the floating surface;
                // skip the posture-aware shell so we don't double up
                // the card chrome.
                shell={false}
              />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

export default RightPanelDrawer;
