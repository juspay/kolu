/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs. */

import { type Component, For } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { TerminalMetadata, RightPanelTab } from "kolu-common";
import MetadataInspector from "./MetadataInspector";
import CodeTab from "./CodeTab";
import { useRightPanel } from "./useRightPanel";
import { ChevronRightIcon } from "../ui/Icons";

type TabProps = {
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
};

type TabDef = {
  label: string;
  component: Component<TabProps>;
};

// Record over the tab enum — TypeScript enforces that every RightPanelTab
// value has an entry, so adding a new tab without a handler fails to
// compile. Iteration order follows object property declaration order.
//
// Intentionally `type`-only import from kolu-common: the sibling value
// `RightPanelTabSchema` would pull `AgentInfoSchema` → `kolu-claude-code`
// → `@anthropic-ai/claude-agent-sdk` into the client bundle, defeating
// tree-shaking.
const TABS: Record<RightPanelTab, TabDef> = {
  inspector: { label: "Inspector", component: MetadataInspector },
  diff: {
    label: "Code",
    component: (p) => <CodeTab meta={p.meta} />,
  },
};

const TAB_IDS = Object.keys(TABS) as RightPanelTab[];

const RightPanel: Component<{
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();

  return (
    <div
      data-testid="right-panel"
      class="flex flex-col h-full min-w-0 overflow-hidden bg-gradient-to-b from-surface-0 to-surface-1/20 border-l border-edge"
    >
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1/50 border-b border-edge">
        <For each={TAB_IDS}>
          {(id) => (
            <button
              data-testid={`right-panel-tab-${id}`}
              data-active={rightPanel.activeTab() === id}
              class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                rightPanel.activeTab() === id
                  ? "font-medium text-fg-2 bg-surface-0 border-b-2 border-accent"
                  : "text-fg-3/50 hover:text-fg-2 hover:bg-surface-0/50"
              }`}
              onClick={() => rightPanel.setActiveTab(id)}
            >
              {TABS[id].label}
            </button>
          )}
        </For>
        <div class="flex-1" />
        <button
          class="px-1.5 h-full transition-colors cursor-pointer"
          classList={{
            "text-accent": rightPanel.pinned(),
            "text-fg-3/40 hover:text-fg-2": !rightPanel.pinned(),
          }}
          onClick={() => rightPanel.togglePinned()}
          aria-label={rightPanel.pinned() ? "Unpin panel" : "Pin panel"}
          title={rightPanel.pinned() ? "Unpin (overlay)" : "Pin (dock)"}
        >
          <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1-.707.707l-.586-.586-3.535 3.536.354 3.182a.5.5 0 0 1-.854.39L7.05 10.293 3.11 14.233a.5.5 0 0 1-.707-.707l3.94-3.94-2.753-2.753a.5.5 0 0 1 .39-.854l3.182.354L10.697 2.8l-.586-.586a.5.5 0 0 1 .146-.854l-.429.638z" />
          </svg>
        </button>
        <button
          class="px-2 h-full text-fg-3/40 hover:text-fg-2 transition-colors cursor-pointer"
          onClick={props.onToggle}
          aria-label="Collapse panel"
        >
          <ChevronRightIcon class="w-3.5 h-3.5" />
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        <Dynamic
          component={TABS[rightPanel.activeTab()].component}
          meta={props.meta}
          themeName={props.themeName}
          onThemeClick={props.onThemeClick}
        />
      </div>
    </div>
  );
};

export default RightPanel;
