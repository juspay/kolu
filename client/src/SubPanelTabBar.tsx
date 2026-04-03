/** Tab bar for split terminals within a parent terminal. */

import { type Component, For } from "solid-js";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { cwdBasename } from "./path";
import SplitBadge from "./SplitBadge";
import { SHORTCUTS, formatKeybind } from "./keyboard";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onSelect: (id: TerminalId) => void;
  onCreate: () => void;
  onCollapse: () => void;
}> = (props) => {
  return (
    <div
      data-testid="sub-panel-tab-bar"
      class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge-bright text-sm min-h-[32px] shrink-0"
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
            <button
              class="px-3 py-1 rounded text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[120px]"
              classList={{
                "bg-surface-2 text-fg font-medium": isActive(),
              }}
              data-active={isActive() || undefined}
              onClick={() => props.onSelect(id)}
            >
              {label()}
            </button>
          );
        }}
      </For>
      <button
        class="px-2 py-1 text-fg-3 hover:text-fg transition-colors cursor-pointer"
        onClick={props.onCreate}
        title="Split terminal"
      >
        +
      </button>
      <SplitBadge
        onClick={props.onCollapse}
        title={`Hide split (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
      >
        ▾ Hide
      </SplitBadge>
    </div>
  );
};

export default SubPanelTabBar;
