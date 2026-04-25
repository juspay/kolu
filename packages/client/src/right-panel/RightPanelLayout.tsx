/** RightPanelLayout — wraps a content area with a resizable right panel.
 *  The panel always docks (Resizable split) when visible; there is no
 *  floating-overlay mode. Mobile hides the panel entirely — the screen is
 *  too narrow for a useful side panel. */

import Resizable from "@corvu/resizable";
import type { TerminalMetadata } from "kolu-common";
import { type Component, type JSX, Show } from "solid-js";
import { isMobile } from "../useMobile";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

const RightPanelLayout: Component<{
  children: JSX.Element;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
}> = (props) => {
  const rightPanel = useRightPanel();

  return (
    <Show
      when={!isMobile()}
      fallback={
        <div
          class={`flex-1 min-h-0 min-w-0 flex overflow-hidden ${props.contentClass ?? ""}`}
        >
          {props.children}
        </div>
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
            <Show when={!rightPanel.collapsed()}>
              <RightPanel
                meta={props.meta}
                onToggle={rightPanel.togglePanel}
                themeName={props.themeName}
                onThemeClick={props.onThemeClick}
              />
            </Show>
          </Resizable.Panel>
        </Resizable>
      </div>
    </Show>
  );
};

export default RightPanelLayout;
