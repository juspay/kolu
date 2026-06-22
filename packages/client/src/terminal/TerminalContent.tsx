/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  sub-panel with tab bar and child terminals.
 *
 *  Used by CanvasTile (desktop) and MobileTileView (mobile). Owns
 *  sub-panel state internally — callers provide only the shell. */

import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import { sleepingArm } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { realSizes } from "../ui/corvuResizable";
import { Z_HANDLE_INNER } from "../ui/stackLayers";
import DormantTileBody from "./DormantTileBody";
import SubPanelTabBar from "./SubPanelTabBar";
import Terminal from "./Terminal";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport
   *  publishing. On the canvas: true for all tiles (always rendered);
   *  on mobile: true only for the visible tile. */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus. True only for
   *  the selected tile on the canvas; same as `visible` on mobile. Also
   *  gates the per-terminal find bar (only the focused terminal shows it). */
  focused: boolean;
  theme: ITheme;
  /** Close a terminal — stays a prop because closing a top-level tile pops
   *  App's root-mounted `<CloseConfirm>` dialog (shell-owned orchestration). */
  onCloseTerminal: (id: TerminalId) => void;
  /** Called when user focuses any terminal in this pane (click, keyboard).
   *  Canvas mode uses this to set the active tile. */
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const subPanel = useSubPanel();
  const search = useTerminalSearch();

  // A sleeping terminal has no live PTY/xterm — render the dormant body instead
  // of the `Terminal` tree. `<Show>` keeps the swap clean: on sleep the live
  // subtree unmounts (xterm dispose, WebGL unload, stream abort via Terminal's
  // onCleanup); on wake it mounts fresh and re-attaches. The discriminant is the
  // single source — no parallel sleeping tile-content kind.
  const isLive = () =>
    sleepingArm(store.getMetadata(props.terminalId)) === undefined;

  const subTerminalIds = () => store.getSubTerminalIds(props.terminalId);
  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => subTerminalIds().length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;

  // One owner for "which pane is live within this tile": only the focused tile's
  // *open* split has a live pane (the `focusTarget` one), reusing the same
  // signal that routes keystrokes — no parallel "active pane" state. Undefined
  // when collapsed or when this tile isn't focused, so no unfocused tile lights
  // a pane. The cue (`paneFocus`) and the keyboard routing (`shouldFocusSub`)
  // below both read this, so they can't drift.
  const livePane = () =>
    props.focused && isExpanded() ? focusTarget() : undefined;

  // Which pane the active-terminal cue marks: the live pane is "active", the
  // other "inactive" (it recedes via the `data-pane-focus` CSS rule).
  const paneFocus = (
    pane: "main" | "sub",
  ): "active" | "inactive" | undefined =>
    livePane() === undefined
      ? undefined
      : livePane() === pane
        ? "active"
        : "inactive";

  const shouldFocusMain = () =>
    props.focused && (!isExpanded() || focusTarget() === "main");
  const shouldFocusSub = (subId: TerminalId) =>
    livePane() === "sub" && activeSubTab() === subId;

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle.
    // `> 0.02` ignores the tiny `[1, 0]` values Corvu fires during
    // programmatic transitions (e.g. expand from collapsed), which would
    // immediately re-collapse the panel.
    const s = realSizes(sizes);
    if (s && s[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, s[1]);
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
    <Show
      when={isLive()}
      fallback={
        <DormantTileBody
          terminalId={props.terminalId}
          onWake={() => void crud.handleWake(props.terminalId)}
          onFocus={props.onFocus}
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
        class="flex-1 min-h-0"
      >
        <Resizable.Panel
          as="div"
          class="min-h-0 overflow-hidden"
          minSize={0.2}
          data-pane="main"
          data-pane-focus={paneFocus("main")}
        >
          <Terminal
            terminalId={props.terminalId}
            visible={props.visible}
            focused={shouldFocusMain()}
            theme={props.theme}
            searchOpen={props.focused && search.isOpen(props.terminalId)}
            onSearchOpenChange={(open) =>
              search.setOpen(props.terminalId, open)
            }
            onFocus={handleMainFocus}
            refocusNonce={panelState().refocusNonce}
          />
        </Resizable.Panel>

        {/* Resize handle — invisible hit zone, visible on hover.
         *  `Z_HANDLE_INNER` mirrors CodeTab.tsx's inner-handle defense:
         *  the ::before pseudo overlaps the previous panel (xterm tile)
         *  by 4px and any positioned descendant inside that panel with
         *  auto/zero z-index would otherwise paint over the hit zone.
         *  The canvas-tile container that hosts this tree creates its
         *  own stacking context (`Z_CANVAS_TILE_ACTIVE`), so external
         *  z-stackers can't intrude — but the defense belongs on the
         *  handle itself so a future xterm overlay with an explicit
         *  z-index doesn't silently break drag-to-resize.
         *  See `ui/stackLayers.ts` for the full layering contract. */}
        <Show when={hasSubs()}>
          <Resizable.Handle
            data-testid="resize-handle"
            class="shrink-0 transition-all"
            classList={{
              "h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors":
                isExpanded(),
              "h-0": !isExpanded(),
            }}
            style={{ "z-index": Z_HANDLE_INNER }}
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
          data-pane="sub"
          data-pane-focus={paneFocus("sub")}
        >
          <Show when={isExpanded()}>
            <SubPanelTabBar
              subIds={subTerminalIds()}
              activeSubTab={activeSubTab()}
              getMetadata={store.getMetadata}
              onSelect={(id) => subPanel.setActiveSubTab(props.terminalId, id)}
              onClose={props.onCloseTerminal}
              onCollapse={() => subPanel.collapsePanel(props.terminalId)}
              onCreate={() =>
                void crud.handleCreateSubTerminal(
                  props.terminalId,
                  store.activeMeta()?.cwd,
                )
              }
            />
          </Show>
          <div class="flex-1 min-h-0">
            <For each={subTerminalIds()}>
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
                  refocusNonce={panelState().refocusNonce}
                  isSub
                />
              )}
            </For>
          </div>
        </Resizable.Panel>
      </Resizable>
    </Show>
  );
};

export default TerminalContent;
