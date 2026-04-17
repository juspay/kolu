/** Tab bar for sub-terminals within a parent's sub-panel. */

import { type Component, For } from "solid-js";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { cwdBasename } from "../path";

const SubPanelTabBar: Component<{
  subIds: TerminalId[];
  activeSubTab: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  onCreate: () => void;
  onCollapse: () => void;
}> = (props) => {
  /** Single delegated click handler. Per-button inline `onClick={() => …}`
   *  closures each share a V8 Context chain with every other closure in this
   *  component body, so they pin the whole `props`+`For`-iteration scope past
   *  dispose — same retention pattern that's been fixed in Terminal.tsx
   *  container div and CanvasTile resize handles. Delegation here collapses
   *  N+2 inline closures per mount to exactly one. */
  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest<HTMLElement>("[data-sub-action]");
    if (!el) return;
    const action = el.dataset.subAction;
    const id = el.dataset.subId as TerminalId | undefined;
    if (action === "select" && id) props.onSelect(id);
    else if (action === "close" && id) {
      e.stopPropagation();
      props.onClose(id);
    } else if (action === "create") props.onCreate();
    else if (action === "collapse") props.onCollapse();
  }

  return (
    <div
      data-testid="sub-panel-tab-bar"
      class="flex items-center gap-1 px-2 py-1 bg-surface-0 border-b border-edge text-sm min-h-[32px] shrink-0"
      onClick={onClick}
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
                class="px-3 pr-6 py-1 rounded text-fg-3 hover:text-fg transition-colors cursor-pointer truncate max-w-[120px]"
                classList={{
                  "bg-surface-2 text-fg font-medium": isActive(),
                }}
                data-active={isActive() || undefined}
                data-sub-action="select"
                data-sub-id={id}
              >
                {label()}
              </button>
              <span
                data-testid="sub-tab-close"
                class="absolute top-0.5 right-0.5 hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer text-xs"
                data-sub-action="close"
                data-sub-id={id}
                title="Close sub-terminal"
              >
                ×
              </span>
            </div>
          );
        }}
      </For>
      <button
        class="px-2 py-1 text-fg-3 hover:text-fg transition-colors cursor-pointer"
        data-sub-action="create"
        title="Split terminal"
      >
        +
      </button>
      <div class="flex-1" />
      <button
        class="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono text-fg-3 hover:text-fg-2 hover:bg-surface-2 transition-colors cursor-pointer"
        data-sub-action="collapse"
        title="Hide terminal split"
      >
        <span class="text-[10px]">▾</span> Hide
      </button>
    </div>
  );
};

export default SubPanelTabBar;
