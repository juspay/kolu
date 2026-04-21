/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via a discriminated union so
 *  illegal pairings (e.g. Inspector-with-a-code-mode) can't be represented. */

import { type Component, For } from "solid-js";
import { match } from "ts-pattern";
import type { TerminalMetadata, RightPanelTabKind } from "kolu-common";
import MetadataInspector from "./MetadataInspector";
import CodeTab from "./CodeTab";
import { useRightPanel } from "./useRightPanel";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import { ChevronRightIcon, PinIcon } from "../ui/Icons";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";

/** Ordered tab kinds shown in the tab bar. Adding a new kind to the
 *  discriminated union requires a corresponding entry here AND a branch
 *  in the `match(tab)` below — both will fail-compile if you miss one. */
const TAB_KINDS: readonly RightPanelTabKind[] = ["inspector", "code"] as const;

const TAB_LABEL: Record<RightPanelTabKind, string> = {
  inspector: "Inspector",
  code: "Code",
};

const RightPanel: Component<{
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  return (
    <div
      data-testid="right-panel"
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge"
    >
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <button
                data-testid={`right-panel-tab-${kind}`}
                data-active={isActive()}
                class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                  isActive()
                    ? "font-medium text-fg-2 bg-surface-0 border-b-2"
                    : "text-fg-3/50 hover:text-fg-2 hover:bg-surface-0/50 border-b-2 border-transparent"
                }`}
                style={{
                  "border-bottom-color": isActive()
                    ? ACTIVE_TERMINAL_ACCENT
                    : undefined,
                }}
                onClick={() => showKind(kind)}
              >
                {TAB_LABEL[kind]}
              </button>
            );
          }}
        </For>
        <div class="flex-1" />
        <div class="flex items-center gap-0.5 pr-1">
          <button
            class={`${CHROME_ICON_BUTTON_CLASS} hover:bg-surface-0/50`}
            classList={{
              "text-fg-3/70 hover:text-fg-2": !rightPanel.pinned(),
            }}
            style={{
              color: rightPanel.pinned() ? ACTIVE_TERMINAL_ACCENT : undefined,
            }}
            onClick={() => rightPanel.togglePinned()}
            aria-label={rightPanel.pinned() ? "Unpin panel" : "Pin panel"}
            title={rightPanel.pinned() ? "Unpin (overlay)" : "Pin (dock)"}
          >
            <PinIcon />
          </button>
          <button
            class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden">
        {match(rightPanel.activeTab())
          .with({ kind: "inspector" }, () => (
            <MetadataInspector
              meta={props.meta}
              themeName={props.themeName}
              onThemeClick={props.onThemeClick}
            />
          ))
          .with({ kind: "code" }, () => <CodeTab meta={props.meta} />)
          .exhaustive()}
      </div>
    </div>
  );
};

export default RightPanel;
