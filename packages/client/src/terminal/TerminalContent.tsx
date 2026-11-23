/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  sub-panel with tab bar and child terminals.
 *
 *  Used by CanvasTile (desktop) and MobileTileView (mobile). Owns
 *  sub-panel state internally — callers provide only the shell. */

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

// Active-terminal cue, shared by both split panes: the pane that does NOT hold
// keyboard focus recedes so the live one stands out. Opacity only — the pane's
// box never resizes, so xterm never refits its grid; `motion-safe` cross-fades
// the change while reduced-motion gets it instantly. The `data-pane-focus`
// attribute (driven by `paneFocus`/`livePane`) selects which pane it dims.
const RECEDE_INACTIVE_PANE =
  "data-[pane-focus=inactive]:opacity-40 motion-safe:transition-opacity motion-safe:duration-[120ms]";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether a user can SEE this terminal — controls focus, fit, viewport
   *  publishing and whether the pane holds an attach stream at all. The
   *  SHELL that places the body answers it: the canvas tile's rect against
   *  the camera (`canvas/tileSeen.ts`), the touch shells' active tile. */
  visible: boolean;
  /** Is this tile's BOX one the shell's layout decided? False while the tile
   *  is parked behind a maximized sibling: it is still attached (`visible`),
   *  and those are two different facts — a covered tile may be read from, and
   *  may not state a size. The canvas answers it per mode; the touch shells
   *  place one tile at a time and always answer true. */
  boxDecided: boolean;
  /** Is the VIEW the shell draws this tile in the one in front? False while
   *  the Conductor covers the workspace: the tile stays attached and drawing,
   *  and its panes state no size. Every shell answers it — the canvas and the
   *  touch shells alike. */
  viewShown: boolean;
  /** Whether this terminal should grab keyboard focus. True only for
   *  the selected tile on the canvas; same as `visible` on mobile. Also
   *  gates the per-terminal find bar (only the focused terminal shows it). */
  focused: boolean;
  theme: ITheme;
  /** Close a terminal — stays a prop because closing a top-level tile pops
   *  App's root-mounted `<CloseConfirm>` dialog (shell-owned orchestration). */
  onCloseTerminal: (id: TerminalId) => void;
  /** Called when a user gesture moves focus into a terminal in this pane. */
  onFocus?: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const subPanel = useSubPanel();
  const search = useTerminalSearch();

  // The live/dormant swap is PER PANE, not per tile: sleeping a family freezes
  // the tile AND every split, so the tile keeps its `Resizable` + tab strip while
  // each pane swaps its own `Terminal` for the dormant body. `<Show>` keeps each
  // swap clean: on sleep that pane's live subtree unmounts (xterm dispose, WebGL
  // unload, stream abort via Terminal's onCleanup); on wake it mounts fresh and
  // re-attaches. The discriminant is the single source — no parallel
  // sleeping-tile-content kind.
  const mainLive = () =>
    sleepingArm(store.getMetadata(props.terminalId)) === undefined;
  const subLive = (id: TerminalId) =>
    sleepingArm(store.getMetadata(id)) === undefined;

  // Flat descendants under this root tile — nested splits paint as peers in
  // the tab strip (the canvas flattens; the Dock keeps the true tree).
  const subTerminalIds = () => store.getSplitPaneIds(props.terminalId);
  const savedSplit = () => subPanel.savedSplit(props.terminalId);
  const paneChrome = () => subPanel.paneChrome(props.terminalId);
  const hasSubs = () => subTerminalIds().length > 0;
  const isExpanded = () => hasSubs() && !savedSplit().collapsed;
  const activeSubTab = () => paneChrome().activeSubTab;

  /** THE TILE'S OWN FACT: is the layout its panes sit in the one it has
   *  decided? A pane may state a size only against a decided box, and the kit
   *  will not even measure an undecided one (`XtermOwnProps.boxDecided`).
   *
   *  Two halves, and the tile owns both:
   *
   *   - the SHELL's (`props.boxDecided`) — a covered tile is parked behind a
   *     maximized sibling and its box is wherever it was left, not a layout
   *     anybody chose;
   *   - the PANE SET's — until every terminal of this host has a record, one
   *     of them may yet turn out to be a split of THIS tile, and a tile that
   *     does not know whether it has a split does not know its panes' boxes.
   *     It is the host-wide census (`recordPhases`), not the canvas's
   *     per-tile-set `allRecordsSettled`: a terminal LIST arrives before the
   *     records it names, and an id that is not a tile yet may still be this
   *     tile's split. THIS tile's own record is named separately because a
   *     host switch re-keys the active scope, and for the tick where the new
   *     host has no census yet an empty one would answer "nothing awaited"
   *     about terminals it has never heard of.
   *
   *  It is a fact about the TILE, not a timer and not a reading of the DOM, so
   *  it is true at the instant the geometry below is final — never a frame
   *  later, never a frame early. */
  const boxDecided = () =>
    props.boxDecided &&
    store.getMetadata(props.terminalId) !== undefined &&
    store.recordPhases().awaited === 0;

  // One owner for "which pane is live within this tile": only the focused tile's
  // *open* split has a live pane, folded directly from the one focus fact.
  // Undefined when collapsed or when this tile isn't focused, so no unfocused
  // tile lights a pane. The cue and keyboard routing both read this fold.
  // Membership is the flat split set (not `parentId === tile`), so a nested
  // grandchild focused via the Dock still lights the sub pane.
  const livePane = (): "main" | "sub" | undefined => {
    if (!props.focused || !isExpanded()) return undefined;
    const focusedId = store.focusedTerminalId();
    if (focusedId === props.terminalId) return "main";
    return focusedId !== null && subTerminalIds().includes(focusedId)
      ? "sub"
      : undefined;
  };

  // Which pane the active-terminal cue marks: the live pane is "active", the
  // other "inactive" (which `RECEDE_INACTIVE_PANE` dims).
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
  /** Is this sub pane the one on screen? The selected open tab of a visible
   *  tile — read by both arms (the live `Terminal` and the dormant body, which
   *  mirrors `Terminal`'s own stacking). */
  const subVisible = (subId: TerminalId) =>
    props.visible && isExpanded() && activeSubTab() === subId;

  /** The tile's decided geometry: the fractions its two panes hold. */
  const fractions = (): [number, number] =>
    isExpanded()
      ? [1 - savedSplit().panelSize, savedSplit().panelSize]
      : [1, 0];
  const sizes = controlledSizes(fractions);

  function handleSizesChange(sizes: number[]) {
    // THE LATCH IS NOT THE INSTRUMENT HERE, and using it was a regression. A
    // drag is many reports, and the latch can only say that A gesture is in
    // progress — in a real browser it was being cleared partway through one
    // (the handle is a focusable button that loses focus, loses its pointer
    // capture, or is blurred mid-drag), after which every later report of the
    // same drag was dropped and the divider stopped moving (kolu#2362).
    //
    // What makes a report safe to persist is the VALUE, and that is now
    // decidable because the record is the one source. A mount can no longer
    // report a stale default — `fractions()` is derived from the record, so
    // Corvu is handed, and echoes back, exactly what is already saved, and
    // `SplitPanelStore.write` drops a write of the value already shown. Only a
    // report that genuinely differs — a drag, a keyboard nudge, a clamp of a
    // saved value this tile cannot realise — reaches the server.
    //
    // `> 0.02` still ignores the tiny `[1, 0]` values Corvu fires during a
    // programmatic transition (expand from collapsed), which would otherwise
    // persist a collapse as a zero-height divider. The collapse ITSELF is
    // still latched, below: that is one report, not a stream of them.
    const s = realSizes(sizes);
    if (s && s[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, s[1]);
    }
  }

  // Corvu reports physical collapsed/expanded transitions for controlled sizes;
  // those callbacks do not identify their source. Record an actual handle
  // gesture separately so only pointer/keyboard intent may persist chrome or
  // move focus. A programmatic transition is merely the consequence of the
  // controlled `sizes` value and must not write that value's source state back.
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
        // A Corvu panel takes its fraction from the root once it has
        // REGISTERED, which happens in an effect — until then it falls back to
        // `initialSize`, and the default for that fallback is the whole
        // container. Stating the tile's decided fraction here means the panel
        // element's `flex-basis` is that fraction from its very first frame:
        // there is no instant at which this pane's box is the whole tile while
        // the tile has a split.
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
            viewShown={props.viewShown}
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
        // The sub pane's half of the same first-frame rule as the main pane
        // above: its share is the tile's decided one before Corvu has
        // registered it, not the container it would otherwise fall back to.
        initialSize={fractions()[1]}
        // Only PERSIST a collapse from pointer/keyboard intent on the handle.
        // On a host
        // switch-BACK the sub-terminal metadata (parentId) re-arrives a beat
        // AFTER the tile re-renders, so `hasSubs()` — hence `isExpanded()` —
        // flickers false and drives `sizes` to [1, 0]; Corvu then fires this
        // onCollapse. Persisting `collapsed:true` there LATCHES the split shut:
        // once the metadata lands, the stored `collapsed:true` keeps
        // `isExpanded()` false so the controlled `sizes` never returns to
        // [1-panelSize, panelSize] and the split is lost for good (srid's
        // switch-back split-loss). The intent gate makes every programmatic
        // transition a no-op; the controlled `sizes` re-expands the moment the
        // sub metadata arrives.
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
                  // Already surfaced by the create's own toast, or refused
                  // while the daemon warms — nothing here waits on the split.
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
                  // Mirror `Terminal`'s own stacking for an inactive tab: only
                  // the selected sub occupies the pane, the rest stay absolute
                  // and hidden. A dormant sub reaches this arm, and its Wake
                  // asks for the SUB (`handleWake` climbs to the topmost
                  // dormant ancestor server-side, so the parent comes back too).
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
                  viewShown={props.viewShown}
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
