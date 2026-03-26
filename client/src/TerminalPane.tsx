/** TerminalPane — wraps a main terminal + optional resizable sub-panel below. */

import { type Component, Show, For } from "solid-js";
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
  activeThemeName: string;
  getThemeByName: (name: string) => ITheme;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  onKillSubTerminal: (id: TerminalId) => void;
  activeCwd: CwdInfo | null;
}> = (props) => {
  const subPanel = useSubPanel();

  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => props.subTerminalIds.length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;

  let flexContainerRef!: HTMLDivElement;

  /** Start drag-resize of the sub-panel. Uses the flex container for height reference. */
  function startResize(e: MouseEvent) {
    e.preventDefault();
    const subPanelEl =
      flexContainerRef.querySelector<HTMLElement>("[data-sub-panel]");
    if (!subPanelEl) return;
    const startY = e.clientY;
    const startHeight = subPanelEl.offsetHeight;
    const containerHeight = flexContainerRef.offsetHeight;

    function onMove(ev: MouseEvent) {
      const delta = startY - ev.clientY;
      const newHeight = Math.max(
        60,
        Math.min(containerHeight * 0.8, startHeight + delta),
      );
      subPanel.setPanelSize(props.terminalId, newHeight / containerHeight);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function subTheme(subId: TerminalId): ITheme {
    const m = props.getMeta(subId);
    return props.getThemeByName(m?.themeName ?? props.activeThemeName);
  }

  return (
    <div class="w-full h-full relative" classList={{ hidden: !props.visible }}>
      {/*
        Layout strategy:
        - No subs: main terminal fills the pane
        - Subs expanded: flex column with main + handle + sub-panel
        - Subs collapsed: main fills, indicator bar at bottom

        Main terminal is always mounted once. Sub-terminals mount when
        first created (via Show/For) and stay mounted across collapse/expand.
      */}
      <div ref={flexContainerRef} class="h-full flex flex-col">
        {/* Main terminal — grows to fill available space */}
        <div class="flex-1 min-h-0 overflow-hidden">
          <Terminal
            terminalId={props.terminalId}
            visible={props.visible}
            theme={props.theme}
            searchOpen={props.searchOpen}
            onSearchOpenChange={props.onSearchOpenChange}
          />
        </div>

        {/* Sub-panel section — only rendered when sub-terminals exist */}
        <Show when={hasSubs()}>
          {/* Resize handle — only visible when expanded */}
          <div
            classList={{ hidden: !isExpanded() }}
            class="h-1 bg-edge hover:bg-accent-bright transition-colors cursor-row-resize shrink-0"
            onMouseDown={startResize}
          />

          {/* Sub-panel content */}
          <div
            data-sub-panel
            class="overflow-hidden flex flex-col shrink-0"
            classList={{ hidden: !isExpanded() }}
            style={{
              height: isExpanded() ? `${panelState().panelSize * 100}%` : "0",
            }}
          >
            <SubPanelTabBar
              subIds={props.subTerminalIds}
              activeSubTab={activeSubTab()}
              getMeta={props.getMeta}
              onSelect={(id) => subPanel.setActiveSubTab(props.terminalId, id)}
              onClose={props.onKillSubTerminal}
              onCreate={() =>
                props.onCreateSubTerminal(
                  props.terminalId,
                  props.activeCwd?.cwd,
                )
              }
            />
            <div class="flex-1 min-h-0">
              <For each={props.subTerminalIds}>
                {(subId) => (
                  <Terminal
                    terminalId={subId}
                    visible={
                      props.visible && isExpanded() && activeSubTab() === subId
                    }
                    theme={subTheme(subId)}
                    searchOpen={false}
                    onSearchOpenChange={() => {}}
                  />
                )}
              </For>
            </div>
          </div>

          {/* Collapsed indicator bar */}
          <Show when={!isExpanded()}>
            <button
              class="h-1 w-full bg-accent/60 hover:bg-accent hover:h-1.5 transition-all cursor-pointer shrink-0"
              onClick={() => subPanel.expandPanel(props.terminalId)}
              title={`${props.subTerminalIds.length} sub-terminal${props.subTerminalIds.length > 1 ? "s" : ""} (Ctrl+\`)`}
            />
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default TerminalPane;
