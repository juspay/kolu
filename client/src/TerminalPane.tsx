/** TerminalPane — wraps a main terminal + optional resizable sub-panel below. */

import { type Component, Show, For, createEffect, on } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import type { TerminalId, CwdInfo } from "kolu-common";

const TerminalPane: Component<{
  terminalId: TerminalId;
  visible: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: TerminalId[];
  getMeta: (
    id: TerminalId,
  ) => { cwd?: CwdInfo; themeName?: string } | undefined;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  activeCwd: CwdInfo | null;
}> = (props) => {
  const subPanel = useSubPanel();

  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => props.subTerminalIds.length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;

  // Focus the right terminal when sub-panel expands/collapses.
  // On expand: focus active sub-terminal. On collapse: focus main terminal.
  createEffect(
    on(
      isExpanded,
      (expanded) => {
        if (!props.visible) return;
        const targetId = expanded ? activeSubTab() : props.terminalId;
        if (!targetId) return;
        // Let the layout settle before focusing (Resizable animates sizes)
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLElement>(`[data-terminal-id="${targetId}"]`)
            ?.click();
        });
      },
      { defer: true },
    ),
  );

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
          <Terminal
            terminalId={props.terminalId}
            visible={props.visible}
            theme={props.theme}
            searchOpen={props.searchOpen}
            onSearchOpenChange={props.onSearchOpenChange}
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
              terminalId={props.terminalId}
              visible={props.visible}
              theme={props.theme}
              searchOpen={props.searchOpen}
              onSearchOpenChange={props.onSearchOpenChange}
            />
          </Resizable.Panel>

          {/* Handle + collapsed indicator: always visible when subs exist */}
          <Resizable.Handle
            class={`shrink-0 transition-colors ${
              isExpanded()
                ? "h-1 bg-edge hover:bg-accent-bright cursor-row-resize"
                : "h-1 bg-accent/60 hover:bg-accent cursor-pointer"
            }`}
            aria-label={
              isExpanded()
                ? "Resize sub-panel"
                : `${props.subTerminalIds.length} sub-terminal${props.subTerminalIds.length > 1 ? "s" : ""} (Ctrl+\`)`
            }
            onClick={() => {
              if (!isExpanded()) subPanel.expandPanel(props.terminalId);
            }}
          />

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
                getMeta={props.getMeta}
                onSelect={(id) =>
                  subPanel.setActiveSubTab(props.terminalId, id)
                }
                onCreate={() =>
                  props.onCreateSubTerminal(
                    props.terminalId,
                    props.activeCwd?.cwd,
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
                    theme={props.theme}
                    searchOpen={false}
                    onSearchOpenChange={() => {}}
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
