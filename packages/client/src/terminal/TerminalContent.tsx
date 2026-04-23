/** TerminalContent — main terminal plus per-tile panels (left / right /
 *  bottom). Each panel slot lives in `meta.panels` and is mediated by the
 *  `useTerminalPanels` primitive; this component is the layout shell that
 *  composes the slot frames around the main xterm.
 *
 *  Layout:
 *    - Outer horizontal `<Resizable>`: [left | center+right]
 *    - Middle horizontal `<Resizable>`: [center | right]
 *    - Inner vertical `<Resizable>` (inside center): [main | bottom]
 *
 *  Nested 2-panel Resizables keep each level a well-trodden corvu case;
 *  the trade-off is that growing `left` proportionally shrinks `right`'s
 *  visible width (since they're in separate Resizable scopes). For v1
 *  this is acceptable — most tiles use one or two slots, not all three. */

import { type Component, createMemo, Show } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import PanelHost from "./PanelHost";
import { useTerminalPanels } from "./useTerminalPanels";
import { isMobile } from "../useMobile";
import type {
  CodeTabView,
  PanelEdge,
  TerminalId,
  TerminalMetadata,
} from "kolu-common";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport
   *  publishing. On the canvas: true for all tiles (always rendered);
   *  on mobile: true only for the visible tile. */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus. True only for the
   *  selected tile on the canvas; same as `visible` on mobile. */
  focused: boolean;
  theme: ITheme;
  themeName?: string;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Active terminal metadata — fed to Inspector / Code panels. */
  meta: TerminalMetadata | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  /** Add a sub-terminal tab to the parent's bottom slot. App owns the
   *  underlying terminal-create RPC + panel-mutation step so there's a
   *  single canonical implementation; this component just signals
   *  intent. */
  onAddSubTerminalTab: (parentId: TerminalId) => void;
  /** Close a terminal — used when the user dismisses a `kind: "terminal"`
   *  tab. The panels primitive removes the tab; this kills the underlying
   *  PTY. The server prunes any dangling references in panels. */
  onCloseTerminal: (id: TerminalId) => void;
  /** Called when the user focuses any region in this tile (main or panel).
   *  Canvas mode uses this to set the active tile. */
  onFocus?: () => void;
  /** Inspector "Theme" row click — opens command palette. */
  onThemeClick?: () => void;
}> = (props) => {
  const panels = useTerminalPanels();

  const left = () => panels.getSlot(props.terminalId, "left");
  const right = () => panels.getSlot(props.terminalId, "right");
  const bottom = () => panels.getSlot(props.terminalId, "bottom");

  // On mobile, side panels (left/right) are hidden — the burger menu is
  // the entry point there. Bottom slot still renders inline so the existing
  // sub-terminal split UX is preserved on mobile.
  const sidePanelsVisible = () => !isMobile();

  const leftActive = createMemo(
    () => sidePanelsVisible() && Boolean(left() && !left()!.collapsed),
  );
  const rightActive = createMemo(
    () => sidePanelsVisible() && Boolean(right() && !right()!.collapsed),
  );
  const bottomActive = createMemo(() =>
    Boolean(bottom() && !bottom()!.collapsed),
  );

  const focusEdge = () => panels.getFocusEdge(props.terminalId);
  const mainFocused = () => props.focused && focusEdge() === "main";
  const slotFocused = (edge: PanelEdge) =>
    props.focused && focusEdge() === edge;

  function handleMainFocus() {
    panels.setFocusEdge(props.terminalId, "main");
    props.onFocus?.();
  }
  function handleSlotFocus(edge: PanelEdge) {
    panels.setFocusEdge(props.terminalId, edge);
    props.onFocus?.();
  }

  function setCodeMode(edge: PanelEdge, mode: CodeTabView): void {
    const slot = panels.getSlot(props.terminalId, edge);
    if (!slot) return;
    const active = slot.tabs[slot.active];
    if (!active || active.kind !== "code") return;
    panels.setTabContent(props.terminalId, edge, slot.active, {
      kind: "code",
      mode,
    });
  }

  function handleCloseTab(edge: PanelEdge, tabIdx: number): void {
    const slot = panels.getSlot(props.terminalId, edge);
    if (!slot) return;
    const tab = slot.tabs[tabIdx];
    panels.closeTab(props.terminalId, edge, tabIdx);
    if (tab?.kind === "terminal") props.onCloseTerminal(tab.id);
  }

  // Main terminal occupies a fraction of [main+bottom] vertical pair.
  const bottomSize = () => (bottomActive() ? bottom()!.size : 0);
  const mainSize = () => 1 - bottomSize();

  const leftSize = () => (leftActive() ? left()!.size : 0);
  const rightSize = () => (rightActive() ? right()!.size : 0);

  function handleOuterSizesChange(sizes: number[]) {
    const next = sizes[0];
    if (next !== undefined && next > 0.02 && leftActive()) {
      panels.setSize(props.terminalId, "left", next);
    }
  }
  function handleMiddleSizesChange(sizes: number[]) {
    const next = sizes[1];
    if (next !== undefined && next > 0.02 && rightActive()) {
      panels.setSize(props.terminalId, "right", next);
    }
  }
  function handleInnerSizesChange(sizes: number[]) {
    const next = sizes[1];
    if (next !== undefined && next > 0.02 && bottomActive()) {
      panels.setSize(props.terminalId, "bottom", next);
    }
  }

  // Build the inner (main + bottom) vertical region.
  const renderCenter = () => (
    <Resizable
      orientation="vertical"
      sizes={[mainSize(), bottomSize()]}
      onSizesChange={handleInnerSizesChange}
      class="flex-1 min-h-0"
    >
      <Resizable.Panel as="div" class="min-h-0 overflow-hidden" minSize={0.2}>
        <Terminal
          terminalId={props.terminalId}
          visible={props.visible}
          focused={mainFocused()}
          theme={props.theme}
          searchOpen={props.searchOpen}
          onSearchOpenChange={props.onSearchOpenChange}
          onFocus={handleMainFocus}
        />
      </Resizable.Panel>
      <Show when={bottomActive()}>
        <Resizable.Handle
          data-testid="resize-handle-bottom"
          class="shrink-0 h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors"
          aria-label="Resize bottom panel"
        />
      </Show>
      <Resizable.Panel
        as="div"
        class="min-h-0 overflow-hidden"
        minSize={0}
        collapsible
        collapsedSize={0}
        onCollapse={() =>
          bottom() && panels.toggleSlot(props.terminalId, "bottom")
        }
      >
        <Show when={bottomActive() && bottom()}>
          {(slot) => (
            <PanelHost
              hostTerminalId={props.terminalId}
              edge="bottom"
              slot={slot()}
              visible={props.visible}
              focused={slotFocused("bottom")}
              theme={props.theme}
              themeName={props.themeName}
              meta={props.meta}
              getMetadata={props.getMetadata}
              onSelectTab={(idx) =>
                panels.setActiveTab(props.terminalId, "bottom", idx)
              }
              onCloseTab={(idx) => handleCloseTab("bottom", idx)}
              onAddTab={() => props.onAddSubTerminalTab(props.terminalId)}
              onCollapse={() => panels.toggleSlot(props.terminalId, "bottom")}
              onMoveTab={(idx, target) =>
                panels.moveTabToEdge(props.terminalId, "bottom", idx, target)
              }
              onCodeModeChange={(mode) => setCodeMode("bottom", mode)}
              onThemeClick={props.onThemeClick}
              onFocus={() => handleSlotFocus("bottom")}
            />
          )}
        </Show>
      </Resizable.Panel>
    </Resizable>
  );

  // Build the middle (center + right) horizontal region.
  const renderMiddle = () => (
    <Resizable
      orientation="horizontal"
      sizes={[1 - rightSize(), rightSize()]}
      onSizesChange={handleMiddleSizesChange}
      class="flex-1 min-w-0"
    >
      <Resizable.Panel
        as="div"
        class="min-w-0 min-h-0 flex flex-col"
        minSize={0.2}
      >
        {renderCenter()}
      </Resizable.Panel>
      <Show when={rightActive()}>
        <Resizable.Handle
          data-testid="resize-handle-right"
          class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
          aria-label="Resize right panel"
        />
      </Show>
      <Resizable.Panel
        as="div"
        class="min-w-0 min-h-0 overflow-hidden"
        minSize={0}
        collapsible
        collapsedSize={0}
        onCollapse={() =>
          right() && panels.toggleSlot(props.terminalId, "right")
        }
      >
        <Show when={rightActive() && right()}>
          {(slot) => (
            <PanelHost
              hostTerminalId={props.terminalId}
              edge="right"
              slot={slot()}
              visible={props.visible}
              focused={slotFocused("right")}
              theme={props.theme}
              themeName={props.themeName}
              meta={props.meta}
              getMetadata={props.getMetadata}
              onSelectTab={(idx) =>
                panels.setActiveTab(props.terminalId, "right", idx)
              }
              onCloseTab={(idx) => handleCloseTab("right", idx)}
              onCollapse={() => panels.toggleSlot(props.terminalId, "right")}
              onMoveTab={(idx, target) =>
                panels.moveTabToEdge(props.terminalId, "right", idx, target)
              }
              onCodeModeChange={(mode) => setCodeMode("right", mode)}
              onThemeClick={props.onThemeClick}
              onFocus={() => handleSlotFocus("right")}
            />
          )}
        </Show>
      </Resizable.Panel>
    </Resizable>
  );

  return (
    <Resizable
      orientation="horizontal"
      sizes={[leftSize(), 1 - leftSize()]}
      onSizesChange={handleOuterSizesChange}
      class="flex-1 min-w-0"
    >
      <Resizable.Panel
        as="div"
        class="min-w-0 min-h-0 overflow-hidden"
        minSize={0}
        collapsible
        collapsedSize={0}
        onCollapse={() => left() && panels.toggleSlot(props.terminalId, "left")}
      >
        <Show when={leftActive() && left()}>
          {(slot) => (
            <PanelHost
              hostTerminalId={props.terminalId}
              edge="left"
              slot={slot()}
              visible={props.visible}
              focused={slotFocused("left")}
              theme={props.theme}
              themeName={props.themeName}
              meta={props.meta}
              getMetadata={props.getMetadata}
              onSelectTab={(idx) =>
                panels.setActiveTab(props.terminalId, "left", idx)
              }
              onCloseTab={(idx) => handleCloseTab("left", idx)}
              onCollapse={() => panels.toggleSlot(props.terminalId, "left")}
              onMoveTab={(idx, target) =>
                panels.moveTabToEdge(props.terminalId, "left", idx, target)
              }
              onCodeModeChange={(mode) => setCodeMode("left", mode)}
              onThemeClick={props.onThemeClick}
              onFocus={() => handleSlotFocus("left")}
            />
          )}
        </Show>
      </Resizable.Panel>
      <Show when={leftActive()}>
        <Resizable.Handle
          data-testid="resize-handle-left"
          class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
          aria-label="Resize left panel"
        />
      </Show>
      <Resizable.Panel
        as="div"
        class="min-w-0 min-h-0 flex flex-col"
        minSize={0.2}
      >
        {renderMiddle()}
      </Resizable.Panel>
    </Resizable>
  );
};

export default TerminalContent;
