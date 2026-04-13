/** RightPanel — right panel shell with tab bar.
 *  Phase 0 has one tab (Inspector); future phases add more. */

import type { Component } from "solid-js";
import type { TerminalMetadata } from "kolu-common";
import MetadataInspector from "./MetadataInspector";

const RightPanel: Component<{
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
  return (
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
        <MetadataInspector
          meta={props.meta}
          themeName={props.themeName}
          onThemeClick={props.onThemeClick}
        />
      </div>
    </div>
  );
};

export default RightPanel;
