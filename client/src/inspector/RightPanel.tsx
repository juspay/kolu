/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector, Files, and Git tabs. */

import { type Component, For } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { TerminalMetadata, RightPanelTab } from "kolu-common";
import MetadataInspector from "./MetadataInspector";
import FilesTab from "./FilesTab";
import GitTab from "./GitTab";
import { useRightPanel } from "./useRightPanel";

type TabProps = {
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
};

const TABS: {
  id: RightPanelTab;
  label: string;
  component: Component<TabProps>;
}[] = [
  { id: "inspector", label: "Inspector", component: MetadataInspector },
  { id: "files", label: "Files", component: (p) => <FilesTab meta={p.meta} /> },
  { id: "git", label: "Git", component: (p) => <GitTab meta={p.meta} /> },
];

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
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge"
    >
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1/50">
        <For each={TABS}>
          {(tab) => (
            <button
              data-testid={`right-panel-tab-${tab.id}`}
              class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                rightPanel.activeTab() === tab.id
                  ? "font-medium text-fg-2 border-b border-accent"
                  : "text-fg-3/50 hover:text-fg-2"
              }`}
              onClick={() => rightPanel.setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
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
        <Dynamic
          component={
            TABS.find((t) => t.id === rightPanel.activeTab())?.component ??
            TABS[0]!.component
          }
          meta={props.meta}
          themeName={props.themeName}
          onThemeClick={props.onThemeClick}
        />
      </div>
    </div>
  );
};

export default RightPanel;
