/** TerminalPane — wraps a main terminal + optional resizable sub-panel below. */

import { type Component, Show, For } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import SplitStrip from "./SplitStrip";
import { useSubPanel } from "./useSubPanel";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TerminalPane: Component<{
  terminalId: TerminalId;
  visible: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: TerminalId[];
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  onCloseTerminal: (id: TerminalId) => void;
  activeMeta: TerminalMetadata | null;
  scrollLockEnabled?: boolean;
  /** Publish this main terminal's cols×rows so sidebar previews can mirror. */
  onDimensionsChange?: (cols: number, rows: number) => void;
}> = (props) => {
  const subPanel = useSubPanel();

  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => props.subTerminalIds.length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;
  const shouldFocusMain = () =>
    props.visible && (!isExpanded() || focusTarget() === "main");
  const shouldFocusSub = (subId: TerminalId) =>
    props.visible &&
    isExpanded() &&
    activeSubTab() === subId &&
    focusTarget() === "sub";

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle
    if (sizes[1] !== undefined && sizes[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, sizes[1]);
    }
  }

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      {/*
        No subs: plain terminal. With subs: Resizable split.
        Sub-terminals mount once via Show+For and stay alive across collapse.
      */}
      <Show
        when={hasSubs()}
        fallback={
          <div class="flex flex-col h-full">
            <div class="flex-1 min-h-0">
              <Terminal
                terminalId={props.terminalId}
                visible={props.visible}
                theme={props.theme}
                searchOpen={props.searchOpen}
                onSearchOpenChange={props.onSearchOpenChange}
                scrollLockEnabled={props.scrollLockEnabled}
                onDimensionsChange={props.onDimensionsChange}
              />
            </div>
            <SplitStrip
              variant="prompt"
              onClick={() =>
                props.onCreateSubTerminal(
                  props.terminalId,
                  props.activeMeta?.cwd,
                )
              }
            />
          </div>
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
              terminalId={props.terminalId}
              visible={props.visible}
              focused={shouldFocusMain()}
              theme={props.theme}
              searchOpen={props.searchOpen}
              onSearchOpenChange={props.onSearchOpenChange}
              onFocus={() => subPanel.setFocusTarget(props.terminalId, "main")}
              scrollLockEnabled={props.scrollLockEnabled}
              onDimensionsChange={props.onDimensionsChange}
            />
          </Resizable.Panel>

          {/* Resize handle — only visible when expanded */}
          <Resizable.Handle
            data-testid="resize-handle"
            class="shrink-0 transition-all"
            classList={{
              "h-1 bg-edge hover:bg-accent-bright": isExpanded(),
              "h-0": !isExpanded(),
            }}
            aria-label="Resize terminal split"
          />

          {/* Collapsed strip — plain button, no Corvu resize interference */}
          <Show when={!isExpanded()}>
            <SplitStrip
              variant="collapsed"
              count={props.subTerminalIds.length}
              onClick={() => subPanel.expandPanel(props.terminalId)}
            />
          </Show>

          <Resizable.Panel
            as="div"
            class="min-h-0 overflow-hidden flex flex-col"
            minSize={0}
            collapsible
            collapsedSize={0}
            onCollapse={() => subPanel.collapsePanel(props.terminalId)}
            onExpand={() => subPanel.expandPanel(props.terminalId)}
          >
            <Show when={isExpanded()}>
              <SubPanelTabBar
                subIds={props.subTerminalIds}
                activeSubTab={activeSubTab()}
                getMetadata={props.getMetadata}
                onSelect={(id) =>
                  subPanel.setActiveSubTab(props.terminalId, id)
                }
                onClose={props.onCloseTerminal}
                onCollapse={() => subPanel.collapsePanel(props.terminalId)}
                onCreate={() =>
                  props.onCreateSubTerminal(
                    props.terminalId,
                    props.activeMeta?.cwd,
                  )
                }
              />
            </Show>
            <div class="flex-1 min-h-0">
              <For each={props.subTerminalIds}>
                {(subId) => (
                  <Terminal
                    terminalId={subId}
                    visible={
                      props.visible && isExpanded() && activeSubTab() === subId
                    }
                    focused={shouldFocusSub(subId)}
                    theme={props.theme}
                    searchOpen={false}
                    onSearchOpenChange={() => {}}
                    onFocus={() =>
                      subPanel.setFocusTarget(props.terminalId, "sub")
                    }
                    scrollLockEnabled={props.scrollLockEnabled}
                    isSub
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

export default TerminalPane;
