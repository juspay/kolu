/** TerminalStrip — 2D scrollable canvas of all terminals.
 *  Replaces the sidebar + single-terminal-viewport with a freely
 *  scrollable container (both axes) where all terminals are visible
 *  as tiles in a wrapping grid. Two-finger scroll navigates spatially. */

import { type Component, For, Show } from "solid-js";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import TerminalMeta from "./TerminalMeta";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TILE_WIDTH = 700;
const TILE_HEIGHT = 500;

const TerminalStrip: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  getTerminalTheme: (id: TerminalId) => ITheme;
  onSelect: (id: TerminalId) => void;
  onCloseTerminal: (id: TerminalId) => void;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  activeMeta: TerminalMetadata | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: (id: TerminalId) => TerminalId[];
}> = (props) => {
  const subPanel = useSubPanel();

  return (
    <div
      class="flex-1 min-h-0 overflow-auto p-2"
    >
      <div
        class="flex flex-wrap gap-2 content-start"
        style={{ "min-height": "100%" }}
      >
        <For each={props.terminalIds}>
          {(id) => {
            const isActive = () => props.activeId === id;
            const theme = () => props.getTerminalTheme(id);
            const subIds = () => props.subTerminalIds(id);
            const panelState = () => subPanel.getSubPanel(id);
            const hasSubs = () => subIds().length > 0;
            const isExpanded = () => hasSubs() && !panelState().collapsed;
            const activeSubTab = () => panelState().activeSubTab;
            const focusTarget = () => panelState().focusTarget;

            return (
              <div
                class="flex flex-col rounded-xl overflow-hidden border transition-all duration-150"
                classList={{
                  "border-accent/60 ring-1 ring-accent/30": isActive(),
                  "border-edge/50 hover:border-edge": !isActive(),
                }}
                style={{
                  width: `${TILE_WIDTH}px`,
                  height: `${TILE_HEIGHT}px`,
                  "background-color": theme().background ?? "var(--color-surface-1)",
                }}
                onClick={() => props.onSelect(id)}
              >
                {/* Tile header — terminal meta + close button */}
                <div
                  class="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 cursor-pointer"
                  classList={{
                    "border-accent/30 bg-accent/5": isActive(),
                    "border-edge/30 bg-surface-1/50": !isActive(),
                  }}
                >
                  <div class="flex-1 min-w-0">
                    <TerminalMeta info={props.getDisplayInfo(id)} />
                  </div>
                  <button
                    class="flex items-center justify-center w-5 h-5 rounded-full text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onCloseTerminal(id);
                    }}
                    title="Close terminal"
                  >
                    ×
                  </button>
                </div>

                {/* Terminal body */}
                <div class="flex-1 min-h-0 flex flex-col">
                  <div class="flex-1 min-h-0">
                    <Terminal
                      terminalId={id}
                      visible={true}
                      focused={isActive() && (!isExpanded() || focusTarget() === "main")}
                      theme={theme()}
                      searchOpen={isActive() && props.searchOpen}
                      onSearchOpenChange={props.onSearchOpenChange}
                      onFocus={() => {
                        props.onSelect(id);
                        subPanel.setFocusTarget(id, "main");
                      }}
                    />
                  </div>

                  {/* Sub-panel */}
                  <Show when={isExpanded()}>
                    <div class="border-t border-edge/30">
                      <SubPanelTabBar
                        subIds={subIds()}
                        activeSubTab={activeSubTab()}
                        getMetadata={props.getMetadata}
                        onSelect={(subId) => subPanel.setActiveSubTab(id, subId)}
                        onClose={props.onCloseTerminal}
                        onCollapse={() => subPanel.collapsePanel(id)}
                        onCreate={() =>
                          props.onCreateSubTerminal(id, props.activeMeta?.cwd)
                        }
                      />
                      <div class="h-40">
                        <For each={subIds()}>
                          {(subId) => (
                            <Terminal
                              terminalId={subId}
                              visible={activeSubTab() === subId}
                              focused={
                                isActive() &&
                                isExpanded() &&
                                activeSubTab() === subId &&
                                focusTarget() === "sub"
                              }
                              theme={theme()}
                              searchOpen={false}
                              onSearchOpenChange={() => {}}
                              onFocus={() => subPanel.setFocusTarget(id, "sub")}
                              isSub
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default TerminalStrip;
