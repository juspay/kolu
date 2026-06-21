/** Per-tile chrome rendered into the CanvasTile title bar.
 *
 *  Order (left → right between title and close): agent indicator, theme
 *  pill, split toggle, search, screenshot.
 *
 *  Reads singleton state and verbs directly — store, sub-panel, theme manager,
 *  right panel, tips, plus the command palette, terminal CRUD, and per-terminal
 *  search singletons — per `no-preference-prop-drilling`. The only prop is the
 *  tile `id`. Extracted from App.tsx per kolu#626. */

import { activeArm, sleepingArm, type TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { notesBodyMarkdown } from "../notes/text";
import { useRightPanel } from "../right-panel/useRightPanel";
import { screenshotTerminal } from "../screenshotTerminal";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import AgentIndicator from "../terminal/AgentIndicator";
import { useSubPanel } from "../terminal/useSubPanel";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalSearch } from "../terminal/useTerminalSearch";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useCommandPalette } from "../useCommandPalette";
import {
  MoonIcon,
  NoteIcon,
  ScreenshotIcon,
  SearchIcon,
  SplitToggleIcon,
} from "../ui/Icons";
import Tip from "../ui/Tip";
import { useThemeManager } from "../useThemeManager";

/** Tile chrome buttons share this affordance. Theme pill is wider — it shows
 *  the theme name. Other buttons are square. */
const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const TileTitleActions: Component<{
  id: TerminalId;
}> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const search = useTerminalSearch();
  const commandPalette = useCommandPalette();
  const rightPanel = useRightPanel();
  const subPanel = useSubPanel();
  const { getTerminalThemeName } = useThemeManager();
  const { showTipOnce } = useTips();

  const meta = () => store.getMetadata(props.id);
  // The live-only chrome (split / find / screenshot / agent) needs a live PTY,
  // so it shows only on the active arm; the theme pill stays on both arms (a
  // sleeping tile re-themes through the normal write sink).
  const live = () => activeArm(meta());
  const sleeping = () => sleepingArm(meta()) !== undefined;
  const themeName = () => getTerminalThemeName(props.id);
  const subCount = () => store.getDisplayInfo(props.id)?.subCount ?? 0;
  const splitExpanded = () =>
    subCount() > 0 && !subPanel.getSubPanel(props.id).collapsed;

  /** Chrome-action handler: interacting with a tile's chrome selects that tile,
   *  then runs the action. The "select first" policy lives here once instead of
   *  being re-prefixed at every button — a new chrome button can't forget it. */
  const onTile = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation();
    store.setActiveSilently(props.id);
    fn();
  };

  return (
    <>
      <Show when={activeArm(meta())?.agent}>
        {(agent) => (
          <button
            type="button"
            class={`${TILE_BUTTON_CLASS} px-2`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              onTile(e, () => {
                // The agent indicator is an Inspector entry point — the agent's
                // metadata lives on the Inspector tab. Select it explicitly
                // before revealing, otherwise a fresh terminal (whose Code tab
                // is the default surface) would open on Code instead.
                rightPanel.showInspector();
                rightPanel.reveal();
              })
            }
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
              onClick={(e) =>
                onTile(e, () => {
                  commandPalette.openGroup("Set theme");
                  setTimeout(
                    () => showTipOnce(CONTEXTUAL_TIPS.themeFromPalette),
                    500,
                  );
                })
              }
            >
              {name()}
            </button>
          </Tip>
        )}
      </Show>
      {/* Notes icon — gated on a non-empty body (lines 2+) so it
       *  complements the title chip (which already shows line 1) rather
       *  than duplicating it. Click → Notes tab. Shown on both arms:
       *  notes persist across sleep/wake. */}
      <Show when={notesBodyMarkdown(meta()?.notes)}>
        <Tip label="Open notes">
          <button
            type="button"
            data-testid="tile-notes"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              onTile(e, () => {
                rightPanel.showNotes();
                rightPanel.reveal();
              })
            }
            aria-label="Open notes"
          >
            <NoteIcon />
          </button>
        </Tip>
      </Show>
      <Show when={live()}>
        <Tip label={subCount() > 0 ? "Toggle split" : "Add split"}>
          <button
            type="button"
            data-testid="tile-split-toggle"
            class={`${TILE_BUTTON_CLASS} gap-1 px-1.5`}
            classList={{ "bg-black/20": splitExpanded() }}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onTile(e, () => crud.toggleSubPanel(props.id))}
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
            onClick={(e) => onTile(e, () => search.openFor(props.id))}
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
          onClick={(e) =>
            onTile(e, () => void screenshotTerminal(props.id, meta()))
          }
          title="Screenshot terminal"
          data-testid="screenshot-button"
        >
          <ScreenshotIcon />
        </button>
        <Tip label="Sleep terminal">
          <button
            type="button"
            data-testid="tile-sleep"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onTile(e, () => crud.requestSleep(props.id))}
            aria-label="Sleep terminal"
          >
            <MoonIcon />
          </button>
        </Tip>
      </Show>
      <Show when={sleeping()}>
        <button
          type="button"
          data-testid="tile-wake"
          class={`${TILE_BUTTON_CLASS} gap-1 px-2 text-xs font-semibold`}
          style={{ color: "var(--color-fg-3, currentColor)" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onTile(e, () => void crud.handleWake(props.id))}
          aria-label="Wake terminal"
        >
          <MoonIcon />
          Wake
        </button>
      </Show>
    </>
  );
};

export default TileTitleActions;
