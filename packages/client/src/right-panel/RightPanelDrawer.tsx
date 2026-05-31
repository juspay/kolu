/** RightPanelDrawer — mobile-only host for the right panel.
 *
 *  On mobile, the right panel hosts as a `@corvu/drawer side="bottom"`.
 *  Visibility is the session-local `useRightPanel.drawerOpen()` signal
 *  — dismissing the drawer on a phone is not the same volatility as
 *  toggling the desktop chrome preference (see `useRightPanel.ts`).
 *
 *  On desktop the right panel is hosted by a `@corvu/resizable`
 *  `Resizable` wired up in `App.tsx` — the outer horizontal split between
 *  the canvas and the panel. Both visibility seams — desktop uncollapse
 *  and mobile drawer-open — are dispatched imperatively from
 *  `openInCodeTab` itself; there is no `on(pendingOpen, ...)` subscriber
 *  here for the same reason.
 *
 *  Selection, mode, and tab kind share `useRightPanel` across hosts —
 *  a phone session that ends on `foo.html` reopens on desktop with
 *  `foo.html` already selected. */

import Drawer from "@corvu/drawer";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
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
        // Same soft-keyboard policy the dock/chrome drawers carry: don't
        // restore focus to the terminal textarea on close, or backdrop-
        // dismissing this bottom sheet pops the keyboard with no intent.
        restoreFocus={false}
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

export default RightPanelDrawer;
