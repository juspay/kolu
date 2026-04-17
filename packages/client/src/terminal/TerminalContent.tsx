/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  sub-panel with tab bar and child terminals.
 *
 *  Used by both TerminalPane (focus mode) and CanvasTile (canvas mode).
 *  Owns sub-panel state internally — callers provide only the shell. */

import { type Component, Show, For } from "solid-js";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import Splitter from "../ui/Splitter";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport publishing.
   *  In focus mode: true only for the selected terminal.
   *  In canvas mode: true for all (always rendered). */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus.
   *  In focus mode: same as visible (active terminal gets focus).
   *  In canvas mode: true only for the selected tile. */
  focused: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: TerminalId[];
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  onCloseTerminal: (id: TerminalId) => void;
  activeMeta: TerminalMetadata | null;
  /** Called when user focuses any terminal in this pane (click, keyboard).
   *  Canvas mode uses this to set the active tile. */
  onFocus?: () => void;
}> = (props) => {
  const subPanel = useSubPanel();

  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => props.subTerminalIds.length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;

  const shouldFocusMain = () =>
    props.focused && (!isExpanded() || focusTarget() === "main");
  const shouldFocusSub = (subId: TerminalId) =>
    props.focused &&
    isExpanded() &&
    activeSubTab() === subId &&
    focusTarget() === "sub";

  const sizes = (): [number, number] =>
    isExpanded()
      ? [1 - panelState().panelSize, panelState().panelSize]
      : [1, 0];

  function handleSizesChange(next: readonly [number, number]) {
    // Persist the bottom panel size when user drags the handle.
    // Ignore tiny values — drag-to-zero should not overwrite the last
    // meaningful size; users collapse via the explicit "▾ Hide" button.
    if (next[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, next[1]);
    }
  }

  function handleMainFocus() {
    subPanel.setFocusTarget(props.terminalId, "main");
    props.onFocus?.();
  }

  function handleSubFocus() {
    subPanel.setFocusTarget(props.terminalId, "sub");
    props.onFocus?.();
  }

  return (
    <Splitter
      orientation="vertical"
      sizes={sizes()}
      onSizesChange={handleSizesChange}
      minSizes={[0.2, 0]}
      showHandle={isExpanded()}
      class="flex-1 min-h-0"
      primaryClass="min-h-0 overflow-hidden"
      secondaryClass="min-h-0 overflow-hidden flex flex-col"
      handleTestId="resize-handle"
      handleAriaLabel="Resize terminal split"
      handleClass="shrink-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors h-0"
      primary={
        <Terminal
          terminalId={props.terminalId}
          visible={props.visible}
          focused={shouldFocusMain()}
          theme={props.theme}
          searchOpen={props.searchOpen}
          onSearchOpenChange={props.onSearchOpenChange}
          onFocus={handleMainFocus}
        />
      }
      secondary={
        <>
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
                  onFocus={handleSubFocus}
                  isSub
                />
              )}
            </For>
          </div>
        </>
      }
    />
  );
};

export default TerminalContent;
