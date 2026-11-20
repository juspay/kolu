import Resizable from "@corvu/resizable";
import { sleepingArm } from "@kolu/padi-client/surface";
import type { ITheme } from "@xterm/xterm";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, type JSX, Show } from "solid-js";
import { runAction } from "../runAction";
import { controlledSizes, realSizes } from "../ui/corvuResizable";
import { Z_HANDLE_INNER } from "../ui/stackLayers";
import DormantTileBody from "./DormantTileBody";
import SubPanelTabBar from "./SubPanelTabBar";
import Terminal from "./Terminal";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalSearch } from "./useTerminalSearch";
import { useTerminalStore } from "./useTerminalStore";

const RECEDE_INACTIVE_PANE =
  "data-[pane-focus=inactive]:opacity-40 motion-safe:transition-opacity motion-safe:duration-[120ms]";

const MIN_PERSISTABLE_PANEL_FRACTION = 0.02;

const TerminalContent: Component<{
  terminalId: TerminalId;
  visible: boolean;
  boxDecided: boolean;
  focused: boolean;
  theme: ITheme;
  onCloseTerminal: (id: TerminalId) => void;
  /** Called when a user gesture moves focus into a terminal in this pane. */
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const subPanel = useSubPanel();
  const search = useTerminalSearch();

  const mainLive = () =>
    sleepingArm(store.getMetadata(props.terminalId)) === undefined;
  const subLive = (id: TerminalId) =>
    sleepingArm(store.getMetadata(id)) === undefined;

  const subTerminalIds = () => store.getSplitPaneIds(props.terminalId);
  const savedSplit = () => subPanel.savedSplit(props.terminalId);
  const paneChrome = () => subPanel.paneChrome(props.terminalId);
  const hasSubs = () => subTerminalIds().length > 0;
  const isExpanded = () => hasSubs() && !savedSplit().collapsed;
  const activeSubTab = () => paneChrome().activeSubTab;

  const paneSetSettled = () =>
    store.getMetadata(props.terminalId) !== undefined &&
    store.recordPhases().awaited === 0;
  const boxDecided = () => props.boxDecided && paneSetSettled();

  const livePane = (): "main" | "sub" | undefined => {
    if (!props.focused || !isExpanded()) return undefined;
    const focusedId = store.focusedTerminalId();
    if (focusedId === props.terminalId) return "main";
    return focusedId !== null && subTerminalIds().includes(focusedId)
      ? "sub"
      : undefined;
  };

  const paneFocus = (
    pane: "main" | "sub",
  ): "active" | "inactive" | undefined =>
    livePane() === undefined
      ? undefined
      : livePane() === pane
        ? "active"
        : "inactive";

  const shouldFocusMain = () =>
    props.focused && store.focusedTerminalId() === props.terminalId;
  const shouldFocusSub = (subId: TerminalId) =>
    props.focused && isExpanded() && store.focusedTerminalId() === subId;
  const subVisible = (subId: TerminalId) =>
    props.visible && isExpanded() && activeSubTab() === subId;

  /** The tile's decided geometry: the fractions its two panes hold. */
  const fractions = (): [number, number] =>
    isExpanded()
      ? [1 - savedSplit().panelSize, savedSplit().panelSize]
      : [1, 0];
  const sizes = controlledSizes(fractions);

  const isUserChosenSizes = (s: [number, number]) =>
    s[1] > MIN_PERSISTABLE_PANEL_FRACTION;

  function handleSizesChange(sizes: number[]) {
    const s = realSizes(sizes);
    if (s && isUserChosenSizes(s)) {
      subPanel.setPanelSize(props.terminalId, s[1]);
    }
  }

  let resizeIntent = false;
  const markResizeIntent = () => {
    resizeIntent = true;
  };
  const markKeyboardResizeIntent: JSX.EventHandler<
    HTMLButtonElement,
    KeyboardEvent
  > = (event) => {
    if (
      [
        "Enter",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      markResizeIntent();
  };
  const clearResizeIntent = () => {
    resizeIntent = false;
  };

  function handlePanelCollapse() {
    if (!hasSubs()) return;
    if (resizeIntent) subPanel.collapsePanel(props.terminalId);
  }

  function handlePanelExpand() {
    if (resizeIntent) subPanel.expandAndFocusPanel(props.terminalId);
  }

  return (
    <Resizable
      orientation="vertical"
      sizes={sizes()}
      onSizesChange={handleSizesChange}
      class="flex-1 min-h-0"
    >
      <Resizable.Panel
        as="div"
        class={`relative min-h-0 overflow-hidden ${RECEDE_INACTIVE_PANE}`}
        minSize={0.2}
        initialSize={fractions()[0]}
        data-pane="main"
        data-pane-focus={paneFocus("main")}
      >
        <Show
          when={mainLive()}
          fallback={
            <DormantTileBody
              size="tile"
              terminalId={props.terminalId}
              onWake={() => {
                runAction("wake terminal", crud.handleWake(props.terminalId));
              }}
              onFocus={props.onFocus}
            />
          }
        >
          <Terminal
            terminalId={props.terminalId}
            visible={props.visible}
            boxDecided={boxDecided()}
            focused={shouldFocusMain()}
            theme={props.theme}
            searchOpen={props.focused && search.isOpen(props.terminalId)}
            onSearchOpenChange={(open) =>
              search.setOpen(props.terminalId, open)
            }
            onFocus={() => subPanel.focusMainPane(props.terminalId)}
            refocusNonce={paneChrome().refocusNonce}
          />
        </Show>
      </Resizable.Panel>

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
          onHandleDragStart={markResizeIntent}
          onHandleDragEnd={clearResizeIntent}
          onPointerCancel={clearResizeIntent}
          onLostPointerCapture={clearResizeIntent}
          onKeyDown={markKeyboardResizeIntent}
          onKeyUp={clearResizeIntent}
          onBlur={clearResizeIntent}
        />
      </Show>

      <Resizable.Panel
        as="div"
        class={`min-h-0 overflow-hidden flex flex-col ${RECEDE_INACTIVE_PANE}`}
        minSize={0}
        collapsible
        collapsedSize={0}
        initialSize={fractions()[1]}
        onCollapse={handlePanelCollapse}
        onExpand={handlePanelExpand}
        data-pane="sub"
        data-pane-focus={paneFocus("sub")}
      >
        <div classList={{ hidden: !isExpanded() }} inert={!isExpanded()}>
          <SubPanelTabBar
            subIds={subTerminalIds()}
            activeSubTab={activeSubTab()}
            getMetadata={store.getMetadata}
            canCreate={mainLive()}
            onSelect={(id) => subPanel.selectSubTab(props.terminalId, id)}
            onClose={props.onCloseTerminal}
            onCollapse={() => subPanel.collapsePanel(props.terminalId)}
            onCreate={() =>
              runAction(
                "create split",
                crud
                  .handleCreateSubTerminal(
                    props.terminalId,
                    store.activeMeta()?.cwd,
                  )
                  .pipe(Effect.ignore),
              )
            }
          />
        </div>
        <div class="relative flex-1 min-h-0">
          <For each={subTerminalIds()}>
            {(subId) => (
              <Show
                when={subLive(subId)}
                fallback={
                  <div
                    class="w-full h-full"
                    style={{
                      position: subVisible(subId) ? "relative" : "absolute",
                      inset: "0",
                      "content-visibility": subVisible(subId)
                        ? "visible"
                        : "hidden",
                    }}
                    inert={!subVisible(subId)}
                  >
                    <DormantTileBody
                      size="sub"
                      terminalId={subId}
                      onWake={() => {
                        runAction("wake terminal", crud.handleWake(subId));
                      }}
                      onFocus={() =>
                        subPanel.focusVisibleSubPane(props.terminalId, subId)
                      }
                    />
                  </div>
                }
              >
                <Terminal
                  terminalId={subId}
                  visible={subVisible(subId)}
                  boxDecided={boxDecided()}
                  focused={shouldFocusSub(subId)}
                  theme={props.theme}
                  searchOpen={false}
                  onSearchOpenChange={() => {}}
                  onFocus={() =>
                    subPanel.focusVisibleSubPane(props.terminalId, subId)
                  }
                  refocusNonce={paneChrome().refocusNonce}
                  isSub
                />
              </Show>
            )}
          </For>
        </div>
      </Resizable.Panel>
    </Resizable>
  );
};

export default TerminalContent;
