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
          class="flex flex-col items-center justify-center gap-1.5 w-6 shrink-0
                 bg-surface-0 border-l border-edge/50 hover:bg-surface-1
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
        class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge/50"
      >
        <div class="flex items-center justify-between h-8 px-3 shrink-0 bg-surface-1/50">
          <span class="text-[9px] font-bold uppercase tracking-[0.15em] text-fg-3/60">
            Inspector
          </span>
          <button
            class="p-0.5 text-fg-3/50 hover:text-fg rounded transition-colors cursor-pointer"
            onClick={props.onToggle}
            aria-label="Collapse inspector"
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
