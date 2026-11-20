import { Shown } from "../ui/shown";

import type {
  RightPanelTabKind,
  TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { match } from "ts-pattern";
import { dockRowLabel } from "../canvas/dock/dockRowData";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import CodeTab from "./CodeTab";
import MetadataInspector from "./MetadataInspector";
import { paneDirectory } from "./paneDirectory";
import { useRightPanel } from "./useRightPanel";

const TAB_KINDS: readonly RightPanelTabKind[] = ["code", "inspector"] as const;

const TAB_LABEL: Record<RightPanelTabKind, string> = {
  inspector: "Inspector",
  code: "Code",
};

const RightPanel: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  tileId: TerminalId | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
  visible: boolean;
}> = (props) => {
  const rightPanel = useRightPanel();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  const paneLabel = (): string | null => {
    const meta = props.meta;
    if (!meta) return null;
    if (props.terminalId === null || props.terminalId === props.tileId)
      return null;
    return dockRowLabel(meta, undefined);
  };

  const directory = () => paneDirectory(props.meta);

  return (
    <div
      data-testid="right-panel"
      data-collapsed={props.visible ? undefined : ""}
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0"
      inert={!props.visible}
    >
      <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <button
                type="button"
                data-testid={`right-panel-tab-${kind}`}
                data-active={isActive() ? "" : undefined}
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
            type="button"
            class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <Show when={directory()}>
        {(dir) => (
          <div class="flex items-center gap-1.5 h-6 shrink-0 px-3 bg-surface-1/40 border-b border-edge font-mono text-[10px]">
            <Show when={paneLabel()}>
              {(label) => (
                <span
                  data-testid="right-panel-pane-label"
                  title={`Showing the "${label()}" split`}
                  class="shrink-0 max-w-[12ch] truncate text-fg-3/60"
                >
                  {label()}
                </span>
              )}
            </Show>
            <span
              data-testid="right-panel-directory"
              title={dir().full}
              class="min-w-0 flex-1 truncate text-left"
              style={{ direction: "rtl" }}
            >
              <bdi>
                <span class="font-semibold text-fg-2">{dir().root}</span>
                <span class="opacity-60">{dir().rest}</span>
              </bdi>
            </span>
          </div>
        )}
      </Show>
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <div
                class="h-full w-full"
                style={{
                  position: isActive() ? "relative" : "absolute",
                  inset: "0",
                  "content-visibility": isActive() ? "visible" : "hidden",
                }}
                inert={!isActive()}
                aria-hidden={!isActive()}
              >
                <Shown.Provider value={() => props.visible && isActive()}>
                  {match(kind)
                    .with("inspector", () => (
                      <MetadataInspector
                        meta={props.meta}
                        terminalId={props.terminalId}
                        tileId={props.tileId}
                        themeName={props.themeName}
                        onThemeClick={props.onThemeClick}
                      />
                    ))
                    .with("code", () => (
                      <CodeTab
                        terminalId={props.terminalId}
                        meta={props.meta}
                      />
                    ))
                    .exhaustive()}
                </Shown.Provider>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default RightPanel;
