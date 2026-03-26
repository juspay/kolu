/** Tab bar for sub-terminals within a parent's sub-panel. */

import { type Component, For } from "solid-js";
import type { TerminalId, CwdInfo } from "kolu-common";
import { cwdBasename } from "./path";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMeta: (id: TerminalId) => { cwd?: CwdInfo } | undefined;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  onCreate: () => void;
}> = (props) => {
  return (
    <div class="flex items-center gap-0.5 px-1 py-0.5 bg-surface-0/50 border-b border-edge text-xs min-h-[24px] shrink-0">
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
              class="flex items-center gap-1 px-2 py-0.5 rounded text-fg-2 hover:text-fg transition-colors cursor-pointer group"
              classList={{ "bg-surface-1 text-fg": isActive() }}
              onClick={() => props.onSelect(id)}
            >
              <span class="truncate max-w-[100px]">{label()}</span>
              <span
                class="opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity text-[10px] leading-none"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onClose(id);
                }}
              >
                &times;
              </span>
            </button>
          );
        }}
      </For>
      <button
        class="px-1.5 py-0.5 text-fg-3 hover:text-fg transition-colors cursor-pointer"
        onClick={props.onCreate}
        title="New sub-terminal"
      >
        +
      </button>
    </div>
  );
};

export default SubPanelTabBar;
