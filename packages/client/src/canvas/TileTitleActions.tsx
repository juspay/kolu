/** Per-tile chrome rendered into the CanvasTile title bar.
 *
 *  Order (left → right between title and close): agent indicator, theme
 *  pill, panel-left toggle, panel-bottom toggle, panel-right toggle,
 *  search, screenshot. On mobile a burger replaces the side-panel icons —
 *  side panels don't render inline there.
 *
 *  Reads singleton state (store, panels, theme manager, tips) directly —
 *  per `no-preference-prop-drilling`. App-local imperative actions (palette
 *  open, search open, screenshot, sub-terminal create) are drilled as
 *  props because they're state setters whose ownership belongs at the
 *  orchestration layer. */

import { type Component, Show } from "solid-js";
import type { PanelEdge, TerminalId } from "kolu-common";
import AgentIndicator from "../terminal/AgentIndicator";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTerminalPanels } from "../terminal/useTerminalPanels";
import { useThemeManager } from "../useThemeManager";
import { isMobile } from "../useMobile";
import {
  BurgerIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PanelRightIcon,
  ScreenshotIcon,
  SearchIcon,
} from "../ui/Icons";
import Tip from "../ui/Tip";

const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const TileTitleActions: Component<{
  id: TerminalId;
  /** Open the command palette at a specific group (e.g. "Theme"). */
  onOpenPaletteGroup: (group: string) => void;
  /** Create a sub-terminal under the given parent and add it as a tab in
   *  the parent's bottom panel. App owns this because it must call the
   *  underlying terminal-create RPC and propagate failures. */
  onAddSubTerminalTab: (parentId: TerminalId) => void;
  /** Open a mobile sheet listing this tile's panels. App owns the sheet. */
  onOpenMobilePanelSheet: (parentId: TerminalId) => void;
  onOpenSearch: () => void;
  onScreenshot: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const panels = useTerminalPanels();
  const { activeThemeName } = useThemeManager();

  const meta = () => store.getMetadata(props.id);
  const themeName = () =>
    store.activeId() === props.id ? activeThemeName() : meta()?.themeName;

  function slotState(edge: PanelEdge): "missing" | "collapsed" | "expanded" {
    const slot = panels.getSlot(props.id, edge);
    if (!slot) return "missing";
    return slot.collapsed ? "collapsed" : "expanded";
  }

  function toggleEdge(edge: PanelEdge) {
    const state = slotState(edge);
    if (state === "missing") {
      // Open with default content per edge.
      if (edge === "left") {
        panels.openSlot(props.id, "left", { kind: "code", mode: "local" });
      } else if (edge === "right") {
        panels.openSlot(props.id, "right", { kind: "inspector" });
      } else {
        // bottom — default is a sub-terminal, requires async create
        props.onAddSubTerminalTab(props.id);
      }
      return;
    }
    panels.toggleSlot(props.id, edge);
  }

  function tabCount(edge: PanelEdge): number {
    return panels.getSlot(props.id, edge)?.tabs.length ?? 0;
  }

  function edgeButton(
    edge: PanelEdge,
    label: string,
    Icon: Component<{ class?: string }>,
  ) {
    return (
      <Tip label={label}>
        <button
          data-testid={`tile-panel-toggle-${edge}`}
          class={`${TILE_BUTTON_CLASS} gap-1 px-1.5`}
          classList={{
            "bg-black/20": slotState(edge) === "expanded",
          }}
          style={{ color: "var(--color-fg-3, currentColor)" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            store.setActiveId(props.id);
            toggleEdge(edge);
          }}
          aria-label={label}
        >
          <Icon />
          <Show when={tabCount(edge) > 1}>
            <span
              data-testid={`tile-panel-count-${edge}`}
              class="text-[0.65rem] tabular-nums leading-none"
            >
              {tabCount(edge)}
            </span>
          </Show>
        </button>
      </Tip>
    );
  }

  return (
    <>
      <Show when={meta()?.agent}>
        {(agent) => (
          <button
            class={`${TILE_BUTTON_CLASS} px-2`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.setActiveId(props.id);
              // Click an agent indicator to surface its Inspector. Open the
              // right slot with Inspector if it's not present anywhere yet.
              panels.openSlot(props.id, "right", { kind: "inspector" });
            }}
            title="Open inspector"
          >
            <AgentIndicator agent={agent()} />
          </button>
        )}
      </Show>
      <Show when={themeName()}>
        {(name) => (
          <Tip label={`Theme: ${name()}`}>
            <button
              data-testid="tile-theme-pill"
              class={`${TILE_BUTTON_CLASS} px-2 max-w-[14ch] truncate text-xs`}
              style={{ color: "var(--color-fg-3, currentColor)" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.setActiveId(props.id);
                props.onOpenPaletteGroup("Theme");
              }}
            >
              {name()}
            </button>
          </Tip>
        )}
      </Show>
      <Show
        when={!isMobile()}
        fallback={
          <Tip label="Open panels">
            <button
              data-testid="tile-panel-burger"
              class={`${TILE_BUTTON_CLASS} w-7`}
              style={{ color: "var(--color-fg-3, currentColor)" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.setActiveId(props.id);
                props.onOpenMobilePanelSheet(props.id);
              }}
              aria-label="Open panels"
            >
              <BurgerIcon />
            </button>
          </Tip>
        }
      >
        {edgeButton("left", "Toggle left panel", PanelLeftIcon)}
        {edgeButton("bottom", "Toggle bottom panel", PanelBottomIcon)}
        {edgeButton("right", "Toggle right panel", PanelRightIcon)}
      </Show>
      <Tip label="Find in terminal">
        <button
          data-testid="tile-find"
          class={`${TILE_BUTTON_CLASS} w-7`}
          style={{ color: "var(--color-fg-3, currentColor)" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            store.setActiveId(props.id);
            props.onOpenSearch();
          }}
          aria-label="Find in terminal"
        >
          <SearchIcon />
        </button>
      </Tip>
      <button
        class={`${TILE_BUTTON_CLASS} w-7`}
        style={{ color: "var(--color-fg-3, currentColor)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onScreenshot(props.id);
        }}
        title="Screenshot terminal"
        data-testid="screenshot-button"
      >
        <ScreenshotIcon />
      </button>
    </>
  );
};

export default TileTitleActions;
