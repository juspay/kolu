/** TerminalPane — wraps a main terminal + optional resizable sub-panel below. */

import { type Component, Show, For } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import SplitPrompt from "./SplitPrompt";
import Kbd from "./Kbd";
import { useSubPanel } from "./useSubPanel";
import { SHORTCUTS, formatKeybind } from "./keyboard";
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
              />
            </div>
            <SplitPrompt
              onCreate={() =>
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
            />
          </Resizable.Panel>

          {/* Handle: resize bar when expanded, split count strip when collapsed */}
          <Resizable.Handle
            data-testid={isExpanded() ? "resize-handle" : "collapsed-indicator"}
            class="shrink-0 transition-all"
            classList={{
              "h-1 bg-edge hover:bg-accent-bright cursor-row-resize":
                isExpanded(),
              "h-6 bg-surface-1 border-t border-accent cursor-pointer flex items-center justify-center gap-3 text-[11px] font-mono hover:brightness-110":
                !isExpanded(),
            }}
            aria-label={
              isExpanded()
                ? "Resize terminal split"
                : `${props.subTerminalIds.length} split terminal${props.subTerminalIds.length > 1 ? "s" : ""} (Ctrl+\`)`
            }
            onClick={() => {
              if (!isExpanded()) subPanel.expandPanel(props.terminalId);
            }}
          >
            <Show when={!isExpanded()}>
              <span class="text-accent font-medium">
                ▸ {props.subTerminalIds.length} split
                {props.subTerminalIds.length > 1 ? "s" : ""}
              </span>
              <Kbd>{formatKeybind(SHORTCUTS.toggleSubPanel.keybind)}</Kbd>
            </Show>
          </Resizable.Handle>

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
