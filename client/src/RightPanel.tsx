/** RightPanel — collapsible right panel shell with tab bar.
 *  Phase 0 has one tab (Inspector); future phases add more. */

import { type Component, Show } from "solid-js";
import type { TerminalMetadata } from "kolu-common";
import MetadataInspector from "./MetadataInspector";
import { SHORTCUTS, formatKeybind } from "./keyboard";
import Kbd from "./Kbd";

const RightPanel: Component<{
  meta: TerminalMetadata | null;
  collapsed: boolean;
  onToggle: () => void;
}> = (props) => {
  return (
    <Show
      when={!props.collapsed}
      fallback={
        <button
          data-testid="right-panel-strip"
          class="flex flex-col items-center justify-center gap-1.5 w-6 shrink-0
                 bg-surface-0 border-l border-edge hover:bg-surface-1
                 transition-colors cursor-pointer"
          onClick={props.onToggle}
          aria-label={`Expand inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
        >
          <span class="text-accent/70 text-[10px]">◂</span>
          <Kbd class="text-[8px]">
            {formatKeybind(SHORTCUTS.toggleRightPanel.keybind)}
          </Kbd>
        </button>
      }
    >
      <div
        data-testid="right-panel"
        class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge"
      >
        {/* Tab bar — phase 0 has one tab; future phases add transcript, files, changes */}
        <div class="flex items-center h-8 shrink-0 bg-surface-1/50">
          <button
            class="h-full px-3 text-xs font-medium text-fg-2
                   border-b border-accent"
          >
            Inspector
          </button>
          <div class="flex-1" />
          <button
            class="px-2 h-full text-fg-3/50 hover:text-fg transition-colors cursor-pointer"
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <span class="text-[10px]">▸</span>
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-hidden">
          <MetadataInspector meta={props.meta} />
        </div>
      </div>
    </Show>
  );
};

export default RightPanel;
