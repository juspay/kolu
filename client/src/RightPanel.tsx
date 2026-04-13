/** RightPanel — collapsible right panel shell with edge strip toggle.
 *  Phase 0 renders MetadataInspector directly; view routing added when needed. */

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
          class="flex flex-col items-center justify-center gap-1 w-6 shrink-0
                 bg-surface-1 border-l border-edge hover:bg-surface-2
                 transition-colors cursor-pointer"
          onClick={props.onToggle}
          aria-label={`Expand inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
        >
          <span class="text-accent text-xs">◂</span>
          <Kbd class="text-[9px]">
            {formatKeybind(SHORTCUTS.toggleRightPanel.keybind)}
          </Kbd>
        </button>
      }
    >
      <div
        data-testid="right-panel"
        class="flex flex-col h-full min-w-0 bg-surface-0"
      >
        <div class="flex items-center justify-between h-8 px-3 shrink-0 border-b border-edge bg-surface-1">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-fg-3">
            Inspector
          </span>
          <button
            class="p-0.5 text-fg-3 hover:text-fg rounded transition-colors cursor-pointer"
            onClick={props.onToggle}
            aria-label="Collapse inspector"
          >
            ▸
          </button>
        </div>
        <div class="flex-1 min-h-0">
          <MetadataInspector meta={props.meta} />
        </div>
      </div>
    </Show>
  );
};

export default RightPanel;
