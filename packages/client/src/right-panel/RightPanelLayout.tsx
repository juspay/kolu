/** RightPanelLayout — wraps a content area with a host that surfaces
 *  the right panel for the user.
 *
 *  Two hosts, one content subtree:
 *  - Desktop: `@corvu/resizable` horizontal split. The handle stays in
 *    the DOM even when collapsed (`sizes=[1,0]`) so e2e tests can grab
 *    it and the user can drag-expand without toggling via the button.
 *  - Mobile: `@corvu/drawer side="bottom"`. The same `RightPanel` →
 *    `CodeTab` subtree mounts inside the drawer; selection, mode, and
 *    tabs share `useRightPanel` with desktop, so a phone session that
 *    ends on `foo.html` reopens on desktop with `foo.html` already
 *    selected.
 *
 *  Visibility is one persisted bit: `rightPanel.collapsed`. On desktop
 *  it sizes the Resizable; on mobile it gates the Drawer. Producers
 *  (terminal `path:line` link click, comments-tray jump-to-anchor)
 *  call `openInCodeTab(req)` → `openCodeAt(mode)` → `expandPanel()` →
 *  drawer opens. No mobile-specific front door, no `isMobile()`
 *  branch in the producer. */

import Drawer from "@corvu/drawer";
import Resizable from "@corvu/resizable";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, createEffect, type JSX, on, Show } from "solid-js";
import { isMobile } from "../useMobile";
import { pendingOpen } from "./openInCodeTab";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

const RightPanelLayout: Component<{
  children: JSX.Element;
  /** Active terminal id. Used by the Code tab's iframe-preview path to
   *  build the per-terminal file-serving URL. */
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
}> = (props) => {
  const rightPanel = useRightPanel();

  // Each host owns its own "make visible" semantics in response to a
  // producer's `openInCodeTab` request. Desktop uncollapse writes to
  // persisted prefs; mobile open is session-local. The hook never
  // learns the platform — visibility dispatch lives here.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req) return;
        if (isMobile()) rightPanel.setDrawerOpen(true);
        else if (rightPanel.collapsed()) rightPanel.expandPanel();
      },
      { defer: true },
    ),
  );

  return (
    <Show
      when={!isMobile()}
      fallback={
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
                <div
                  class="flex justify-center py-1.5 shrink-0"
                  aria-hidden="true"
                >
                  <span class="w-10 h-1 rounded-full bg-fg-3/40" />
                </div>
                <div class="flex-1 min-h-0 overflow-hidden">
                  <RightPanel
                    terminalId={props.terminalId}
                    meta={props.meta}
                    onToggle={() => rightPanel.setDrawerOpen(false)}
                    themeName={props.themeName}
                    onThemeClick={props.onThemeClick}
                  />
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer>
        </>
      }
    >
      {/* Always render Resizable (even when collapsed — sizes=[1,0]) so the
       *  handle stays in the DOM for e2e tests and the user can drag-expand
       *  without toggling via the button. */}
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
              class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
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
            />
          </Resizable.Panel>
        </Resizable>
      </div>
    </Show>
  );
};

export default RightPanelLayout;
