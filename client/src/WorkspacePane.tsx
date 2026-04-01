/** WorkspacePane — wraps a main terminal + optional resizable terminal panel below. */

import { type Component, Show, For } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import TerminalTabBar from "./TerminalTabBar";
import { useTerminalPanel } from "./useTerminalPanel";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const WorkspacePane: Component<{
  workspaceId: TerminalId;
  visible: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  terminalIds: TerminalId[];
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onCreateTerminal: (workspaceId: TerminalId, cwd?: string) => void;
  activeMeta: TerminalMetadata | null;
  scrollLockEnabled?: boolean;
}> = (props) => {
  const terminalPanel = useTerminalPanel();

  const panelState = () => terminalPanel.getSubPanel(props.workspaceId);
  const hasTerminals = () => props.terminalIds.length > 0;
  const isExpanded = () => hasTerminals() && !panelState().collapsed;
  const activeTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;
  const shouldFocusMain = () =>
    props.visible && (!isExpanded() || focusTarget() === "main");
  const shouldFocusTerminal = (termId: TerminalId) =>
    props.visible &&
    isExpanded() &&
    activeTab() === termId &&
    focusTarget() === "sub";

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle
    if (sizes[1] !== undefined && sizes[1] > 0.02) {
      terminalPanel.setPanelSize(props.workspaceId, sizes[1]);
    }
  }

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      {/*
        No terminals: plain main terminal. With terminals: Resizable split.
        Terminals mount once via Show+For and stay alive across collapse.
      */}
      <Show
        when={hasTerminals()}
        fallback={
          <Terminal
            terminalId={props.workspaceId}
            visible={props.visible}
            theme={props.theme}
            searchOpen={props.searchOpen}
            onSearchOpenChange={props.onSearchOpenChange}
            scrollLockEnabled={props.scrollLockEnabled}
          />
        }
      >
        <Resizable
          orientation="vertical"
          sizes={
            isExpanded()
              ? [1 - panelState().panelSize, panelState().panelSize]
              : [1, 0]
          }
          onSizesChange={handleSizesChange}
          class="h-full"
        >
          <Resizable.Panel
            as="div"
            class="min-h-0 overflow-hidden"
            minSize={0.2}
          >
            <Terminal
              terminalId={props.workspaceId}
              visible={props.visible}
              focused={shouldFocusMain()}
              theme={props.theme}
              searchOpen={props.searchOpen}
              onSearchOpenChange={props.onSearchOpenChange}
              onFocus={() =>
                terminalPanel.setFocusTarget(props.workspaceId, "main")
              }
              scrollLockEnabled={props.scrollLockEnabled}
            />
          </Resizable.Panel>

          {/* Handle + collapsed indicator: always visible when terminals exist */}
          <Resizable.Handle
            data-testid={isExpanded() ? "resize-handle" : "collapsed-indicator"}
            class={`shrink-0 transition-colors ${
              isExpanded()
                ? "h-1 bg-edge hover:bg-accent-bright cursor-row-resize"
                : "h-1 bg-accent/60 hover:bg-accent cursor-pointer"
            }`}
            aria-label={
              isExpanded()
                ? "Resize terminal panel"
                : `${props.terminalIds.length} terminal${props.terminalIds.length > 1 ? "s" : ""} (Ctrl+\`)`
            }
            onClick={() => {
              if (!isExpanded()) terminalPanel.expandPanel(props.workspaceId);
            }}
          />

          <Resizable.Panel
            as="div"
            class="min-h-0 overflow-hidden flex flex-col"
            minSize={0}
            collapsible
            collapsedSize={0}
            onCollapse={() => terminalPanel.collapsePanel(props.workspaceId)}
            onExpand={() => terminalPanel.expandPanel(props.workspaceId)}
          >
            <Show when={isExpanded()}>
              <TerminalTabBar
                subIds={props.terminalIds}
                activeSubTab={activeTab()}
                getMetadata={props.getMetadata}
                onSelect={(id) =>
                  terminalPanel.setActiveSubTab(props.workspaceId, id)
                }
                onCreate={() =>
                  props.onCreateTerminal(
                    props.workspaceId,
                    props.activeMeta?.cwd,
                  )
                }
              />
            </Show>
            <div class="flex-1 min-h-0">
              <For each={props.terminalIds}>
                {(termId) => (
                  <Terminal
                    terminalId={termId}
                    visible={
                      props.visible && isExpanded() && activeTab() === termId
                    }
                    focused={shouldFocusTerminal(termId)}
                    theme={props.theme}
                    searchOpen={false}
                    onSearchOpenChange={() => {}}
                    onFocus={() =>
                      terminalPanel.setFocusTarget(props.workspaceId, "sub")
                    }
                    scrollLockEnabled={props.scrollLockEnabled}
                  />
                )}
              </For>
            </div>
          </Resizable.Panel>
        </Resizable>
      </Show>
    </div>
  );
};

export default WorkspacePane;
