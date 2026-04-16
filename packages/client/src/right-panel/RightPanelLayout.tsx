/** RightPanelLayout — wraps a content area with a right panel that can be
 *  pinned (docked via Resizable) or unpinned (overlay with backdrop).
 *  Encapsulates the pin/unpin layout decision so callers don't duplicate it. */

import { type Component, type JSX, Show } from "solid-js";
import Resizable from "@corvu/resizable";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";
import type { TerminalMetadata } from "kolu-common";

const RightPanelLayout: Component<{
  children: JSX.Element;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
}> = (props) => {
  const rightPanel = useRightPanel();
  const rightPanelProps = () => ({
    meta: props.meta,
    onToggle: rightPanel.togglePanel,
    themeName: props.themeName,
    onThemeClick: props.onThemeClick,
  });

  return (
    <Show
      when={rightPanel.pinned()}
      fallback={
        <div
          class={`flex-1 min-h-0 min-w-0 flex overflow-hidden relative ${props.contentClass ?? ""}`}
        >
          {props.children}
          {/* Overlay right panel */}
          <Show when={!rightPanel.collapsed()}>
            <>
              <div
                data-testid="right-panel-backdrop"
                class="absolute inset-0 bg-black/20 z-20"
                onClick={() => rightPanel.collapsePanel()}
              />
              <div
                class="absolute top-0 right-0 bottom-0 z-30 w-80 lg:w-96 shadow-2xl shadow-black/30"
                style={{ "max-width": "50%" }}
              >
                <RightPanel {...rightPanelProps()} />
              </div>
            </>
          </Show>
        </div>
      }
    >
      {/* Pinned: always render Resizable (even when collapsed — sizes=[1,0]).
       *  This keeps the handle in the DOM for e2e tests and allows the user
       *  to drag-expand without toggling via the button. */}
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
              <RightPanel {...rightPanelProps()} />
            </Show>
          </Resizable.Panel>
        </Resizable>
      </div>
    </Show>
  );
};

export default RightPanelLayout;
