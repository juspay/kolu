/** Per-tile chrome rendered into the CanvasTile title bar.
 *
 *  Order (left → right between title and close): agent indicator, theme
 *  pill, split toggle, search, screenshot.
 *
 *  Reads singleton state (store, sub-panel, theme manager, right panel,
 *  tips) directly — per `no-preference-prop-drilling`. Only App-local
 *  imperative actions (palette open, search open, screenshot) are drilled
 *  as props because they are state setters whose ownership belongs at the
 *  orchestration layer. Extracted from App.tsx per kolu#626. */

import type { TerminalId } from "kolu-common";
import { type Component, Show } from "solid-js";
import { useRightPanel } from "../right-panel/useRightPanel";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import AgentIndicator from "../terminal/AgentIndicator";
import { useSubPanel } from "../terminal/useSubPanel";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { ScreenshotIcon, SearchIcon, SplitToggleIcon } from "../ui/Icons";
import Tip from "../ui/Tip";
import { useThemeManager } from "../useThemeManager";

/** Tile chrome buttons share this affordance. Theme pill is wider — it shows
 *  the theme name. Other buttons are square. */
const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const TileTitleActions: Component<{
  id: TerminalId;
  /** Open the command palette at a specific group (e.g. "Theme"). */
  onOpenPaletteGroup: (group: string) => void;
  /** Toggle the sub-panel for the given parent — App owns this because it
   *  has to bridge to `crud.handleCreateSubTerminal` when no splits exist. */
  onToggleSubPanel: (parentId: TerminalId) => void;
  /** Open the in-tile search overlay. */
  onOpenSearch: () => void;
  /** Screenshot the given terminal. */
  onScreenshot: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const rightPanel = useRightPanel();
  const subPanel = useSubPanel();
  const { activeThemeName } = useThemeManager();
  const { showTipOnce } = useTips();

  const meta = () => store.getMetadata(props.id);
  const themeName = () =>
    store.activeId() === props.id ? activeThemeName() : meta()?.themeName;
  const subCount = () => store.getSubTerminalIds(props.id).length;
  const splitExpanded = () =>
    subCount() > 0 && !subPanel.getSubPanel(props.id).collapsed;

  return (
    <>
      <Show when={meta()?.agent}>
        {(agent) => (
          <button
            type="button"
            class={`${TILE_BUTTON_CLASS} px-2`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              store.setActiveId(props.id);
              rightPanel.expandPanel();
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
              type="button"
              data-testid="tile-theme-pill"
              class={`${TILE_BUTTON_CLASS} px-2 max-w-[14ch] truncate text-xs`}
              style={{ color: "var(--color-fg-3, currentColor)" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                store.setActiveId(props.id);
                props.onOpenPaletteGroup("Theme");
                setTimeout(
                  () => showTipOnce(CONTEXTUAL_TIPS.themeFromPalette),
                  500,
                );
              }}
            >
              {name()}
            </button>
          </Tip>
        )}
      </Show>
      <Tip label={subCount() > 0 ? "Toggle split" : "Add split"}>
        <button
          type="button"
          data-testid="tile-split-toggle"
          class={`${TILE_BUTTON_CLASS} gap-1 px-1.5`}
          classList={{ "bg-black/20": splitExpanded() }}
          style={{ color: "var(--color-fg-3, currentColor)" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            store.setActiveId(props.id);
            props.onToggleSubPanel(props.id);
          }}
          aria-label="Toggle split"
        >
          <SplitToggleIcon />
          <Show when={subCount() > 0}>
            <span
              data-testid="sub-count"
              class="text-[0.65rem] tabular-nums leading-none"
            >
              {subCount()}
            </span>
          </Show>
        </button>
      </Tip>
      <Tip label="Find in terminal">
        <button
          type="button"
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
        type="button"
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
