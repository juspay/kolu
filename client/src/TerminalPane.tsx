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
    <div
      class="w-full h-full relative flex flex-col"
      classList={{ hidden: !props.visible }}
    >
      {/*
        Main terminal lives inside Resizable unconditionally so it is never
        unmounted when splits are created/removed. Sub-panel content is gated
        by Show/For without affecting the main terminal's lifecycle.
      */}
      <Resizable
        orientation="vertical"
        sizes={
          isExpanded()
            ? [1 - panelState().panelSize, panelState().panelSize]
            : [1, 0]
        }
        onSizesChange={handleSizesChange}
        class="flex-1 min-h-0"
      >
        <Resizable.Panel as="div" class="min-h-0 overflow-hidden" minSize={0.2}>
          <Terminal
            terminalId={props.terminalId}
            visible={props.visible}
            focused={shouldFocusMain()}
            theme={props.theme}
            searchOpen={props.searchOpen}
            onSearchOpenChange={props.onSearchOpenChange}
            onFocus={() => subPanel.setFocusTarget(props.terminalId, "main")}
            scrollLockEnabled={props.scrollLockEnabled}
          />
        </Resizable.Panel>

        {/* Resize handle — invisible hit zone, visible on hover */}
        <Show when={hasSubs()}>
          <Resizable.Handle
            data-testid="resize-handle"
            class="shrink-0 transition-all"
            classList={{
              "h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors":
                isExpanded(),
              "h-0": !isExpanded(),
            }}
            aria-label="Resize terminal split"
          />
        </Show>

        {/* Collapsed strip — plain button, no Corvu resize interference */}
        <Show when={hasSubs() && !isExpanded()}>
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
              onSelect={(id) => subPanel.setActiveSubTab(props.terminalId, id)}
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

      {/* Prompt strip — only when no splits exist */}
      <Show when={!hasSubs()}>
        <SplitStrip
          variant="prompt"
          onClick={() =>
            props.onCreateSubTerminal(props.terminalId, props.activeMeta?.cwd)
          }
        />
      </Show>
    </div>
  );
};

export default TerminalPane;
