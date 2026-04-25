/** Tab bar for sub-terminals within a parent's sub-panel. */

import {
  cwdBasename,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common";
import { type Component, For } from "solid-js";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  onCreate: () => void;
  onCollapse: () => void;
}> = (props) => {
  return (
    <div
      data-testid="sub-panel-tab-bar"
      class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge text-sm min-h-[32px] shrink-0"
    >
      <For each={props.subIds}>
        {(id, index) => {
          const label = () => {
            const m = props.getMetadata(id);
            const base = m ? cwdBasename(m.cwd) : "terminal";
            // Append 1-based index when multiple tabs share the same name
            if (props.subIds.length <= 1) return base;
            return `${base} ${index() + 1}`;
          };
          const isActive = () => props.activeSubTab === id;
          return (
            <div class="group relative">
              <button
                type="button"
                class="px-3 pr-6 py-1 rounded text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[120px]"
                classList={{
                  "bg-surface-2 text-fg font-medium": isActive(),
                }}
                data-active={isActive() || undefined}
                onClick={() => props.onSelect(id)}
              >
                {label()}
              </button>
              <button
                type="button"
                data-testid="sub-tab-close"
                class="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(id);
                }}
                title="Close sub-terminal"
              >
                ×
              </button>
            </div>
          );
        }}
      </For>
      <button
        type="button"
        class="px-2 py-1 text-fg-3 hover:text-fg transition-colors cursor-pointer"
        onClick={props.onCreate}
        title="Split terminal"
      >
        +
      </button>
      <div class="flex-1" />
      <button
        type="button"
        class="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono text-fg-3 hover:text-fg-2 hover:bg-surface-2 transition-colors cursor-pointer"
        onClick={props.onCollapse}
        title="Hide terminal split"
      >
        <span class="text-[10px]">▾</span> Hide
      </button>
    </div>
  );
};

export default SubPanelTabBar;
