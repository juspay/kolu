/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  bottom sub-panel + optional right-side browser region (#633).
 *
 *  Used by CanvasTile (desktop) and MobileTileView (mobile). Owns
 *  sub-panel state internally — callers provide only the shell. */

import { type Component, Show, For } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import BrowserRegion from "../browser/BrowserRegion";
import { client } from "../rpc/rpc";
import { toast } from "solid-sonner";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport
   *  publishing. On the canvas: true for all tiles (always rendered);
   *  on mobile: true only for the visible tile. */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus. True only for
   *  the selected tile on the canvas; same as `visible` on mobile. */
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
  /** Detach the right-side browser region from this terminal (#633). */
  onCloseBrowser?: (id: TerminalId) => void;
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

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle.
    // Ignore tiny values — the Resizable fires onSizesChange with [1, 0]
    // during programmatic transitions (e.g. expand from collapsed), which
    // would immediately re-collapse the panel.
    if (sizes[1] !== undefined && sizes[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, sizes[1]);
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

  // Right-side browser region state — optional, per-terminal, comes from
  // the same metadata stream as subPanel. Reads through the same getter
  // the caller passes so the component doesn't bind to a specific store.
  const browser = () => props.getMetadata(props.terminalId)?.browser;
  const hasBrowser = () => {
    const b = browser();
    return b !== undefined && !b.collapsed;
  };

  function handleBrowserSizesChange(sizes: number[]) {
    const b = browser();
    if (!b) return;
    // sizes[1] is the browser's fraction (right panel). Ignore tiny
    // intermediate values the same way the vertical split does.
    const next = sizes[1];
    if (
      next === undefined ||
      next < 0.05 ||
      Math.abs(next - b.panelSize) < 0.01
    ) {
      return;
    }
    void client.terminal
      .setBrowser({
        id: props.terminalId,
        browser: { ...b, panelSize: next },
      })
      .catch((err: Error) =>
        toast.error(`Failed to save browser layout: ${err.message}`),
      );
  }

  const verticalSplit = () => (
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
          onFocus={handleMainFocus}
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
              props.onCreateSubTerminal(props.terminalId, props.activeMeta?.cwd)
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
      </Resizable.Panel>
    </Resizable>
  );

  // Outer horizontal split: terminal+sub-panel on the left, browser on
  // the right. When no browser is attached, just render the vertical
  // split directly — no wrapper overhead. The browser's own panelSize
  // lives on terminal metadata so it survives reload (see #633 pivot).
  return (
    <Show when={hasBrowser() && browser()} fallback={verticalSplit()} keyed>
      {(b) => (
        <Resizable
          orientation="horizontal"
          sizes={[1 - b.panelSize, b.panelSize]}
          onSizesChange={handleBrowserSizesChange}
          class="flex-1 min-h-0"
        >
          <Resizable.Panel
            as="div"
            class="min-h-0 overflow-hidden flex flex-col"
            minSize={0.2}
          >
            {verticalSplit()}
          </Resizable.Panel>
          <Resizable.Handle
            data-testid="browser-resize-handle"
            class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
            aria-label="Resize browser region"
          />
          <Resizable.Panel
            as="div"
            class="min-h-0 overflow-hidden"
            minSize={0.15}
          >
            <BrowserRegion
              terminalId={props.terminalId}
              browser={b}
              onDetach={() => props.onCloseBrowser?.(props.terminalId)}
            />
          </Resizable.Panel>
        </Resizable>
      )}
    </Show>
  );
};

export default TerminalContent;
