/** Tab bar for sub-terminals within a parent's sub-panel. */

import { type Component, For } from "solid-js";
import type { TerminalId, CwdInfo } from "kolu-common";
import { cwdBasename } from "./path";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMeta: (id: TerminalId) => { cwd?: CwdInfo } | undefined;
  onSelect: (id: TerminalId) => void;
  onCreate: () => void;
}> = (props) => {
  return (
    <div class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge-bright text-sm min-h-[32px] shrink-0">
      <For each={props.subIds}>
        {(id, index) => {
          const label = () => {
            const m = props.getMeta(id);
            const base = m?.cwd ? cwdBasename(m.cwd.cwd) : "terminal";
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
        title="New sub-terminal"
      >
        +
      </button>
    </div>
  );
};

export default SubPanelTabBar;
