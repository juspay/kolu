/** Per-tile chrome rendered into the CanvasTile title bar.
 *
 *  Order (left → right between title and close): agent indicator, agents
 *  chip (the agent-distro profile + bundle the terminal was spawned with),
 *  Restart when those agents went stale, theme pill, split toggle, search, screenshot.
 *
 *  Reads singleton state and verbs directly — store, sub-panel, theme manager,
 *  right panel, tips, plus the command palette, terminal CRUD, and per-terminal
 *  search singletons — per `no-preference-prop-drilling`. The props are the
 *  tile `id` and its `host` (the agents-staleness check reads that host's
 *  status). Extracted from App.tsx per kolu#626. */

import { activeArm, sleepingArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import AgentProfileChip, { type ChipRestart } from "../agents/AgentProfileChip";
import {
  agentDistroSetting,
  hostAgentStatusOf,
} from "../agents/useAgentDistro";
import {
  agentRestartAction,
  agentRestartReady,
  agentStalenessOf,
} from "@kolu/agent-distro/status";
import { agentLive } from "@kolu/terminal-vocab/agentProjection";
import { ACTIONS } from "../input/actions";
import { useRightPanel } from "../right-panel/useRightPanel";
import { runAction, runActionPromise, type UiAction } from "../runAction";
import { screenshotTerminal } from "../screenshotTerminal";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { openSettings } from "../settings/useSettingsOpen";
import { useTips } from "../settings/useTips";
import AgentIndicator from "../terminal/AgentIndicator";
import { useSubPanel } from "../terminal/useSubPanel";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalSearch } from "../terminal/useTerminalSearch";
import { useTerminalStore } from "../terminal/useTerminalStore";
import {
  MoonIcon,
  ScreenshotIcon,
  SearchIcon,
  SplitToggleIcon,
} from "../ui/Icons";
import Tip from "../ui/Tip";
import { useCommandPalette } from "../useCommandPalette";
import { useThemeManager } from "../useThemeManager";
import type { HostKey } from "kolu-common/hostKey";

/** Tile chrome buttons share this affordance. Theme pill is wider — it shows
 *  the theme name. Other buttons are square. */
const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const TileTitleActions: Component<{
  id: TerminalId;
  /** The host this tile's terminal lives on — the agents status a stale check
   *  compares against. */
  host: HostKey;
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
  // Are this LIVE terminal's agents still what a new terminal on its host gets?
  // (The canvas shows the active host's tiles, so that is the host.) A sleeping
  // terminal picks up the current agents when it wakes — nothing to offer.
  const staleness = createMemo(() => {
    const m = live();
    return m === undefined
      ? ({ kind: "current" } as const)
      : agentStalenessOf({
          terminal: m,
          status: hostAgentStatusOf(props.host),
          setting: agentDistroSetting(),
        });
  });
  // Restart only when there is something to restart INTO: agents now off (a
  // plain shell), or the new bundle is on the host. While the new profile
  // downloads the pill stays stale and says so, with no restart on it.
  const restartOffer = (): ChipRestart | undefined => {
    const s = staleness();
    if (s.kind !== "stale" || !agentRestartReady(s)) return undefined;
    return {
      guarded: liveAgent(),
      action: agentRestartAction(s),
      run: (e) =>
        onTilePromise(e, () => runActionPromise(crud.handleRestart(props.id))),
    };
  };
  // A live agent (working, or blocked on you) — Restart would end its process,
  // so the pill asks twice. `agentLive` is the shared fold's answer.
  const liveAgent = () => {
    const agent = live()?.agent;
    return agent != null && agentLive(agent.state);
  };
  const themeName = () => getTerminalThemeName(props.id);
  const subCount = () => store.getDisplayInfo(props.id)?.subCount ?? 0;
  const splitExpanded = () =>
    subCount() > 0 && !subPanel.peekSubPanel(props.id).collapsed;

  /** Chrome-action handler for SYNCHRONOUS chrome: interacting with a tile's
   *  chrome selects that tile, then runs the callback. The "select first" policy
   *  lives here once instead of being re-prefixed at every button — a new chrome
   *  button can't forget it.
   *
   *  Reach for {@link onTileAction} instead whenever the button drives an
   *  `Effect`. `fn: () => void` cannot protect you: TypeScript's void-return rule
   *  accepts a callback returning ANYTHING, so `() => crud.requestSleep(id)`
   *  type-checked while it built an `Effect` and dropped it on the floor — the ☾
   *  Sleep button, the Wake button and the split toggle each did nothing at all,
   *  silently, until `sleeping-terminals.feature` caught all three at once. There
   *  is no type that closes that hole (a `T extends void` parameter just
   *  instantiates to its constraint), so the remedy is structural: hand the
   *  Effect to a helper that runs it, and never have a slot for an un-run one. */
  const onTile = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation();
    store.setActiveSilently(props.id);
    fn();
  };

  /** {@link onTile} for a button whose work is an `Effect`: the same select-first
   *  policy, and the action REACHES `runAction` because handing it over is the
   *  only way to call this. A caller cannot express "built it and forgot to run
   *  it". The action arrives as a THUNK, not a value, so it is still built AFTER
   *  the select — `toggleSubPanel` reads `store.activeMeta()` while describing
   *  itself, and building it first would seed the new split from whichever tile
   *  was active before the click. */
  const onTileAction = (
    e: MouseEvent,
    label: string,
    action: () => UiAction,
  ) => {
    onTile(e, () => {
      runAction(label, action());
    });
  };

  /** {@link onTile} for an action whose settle the caller waits on — the agents
   *  pill's restart, which stays busy until the restart has happened. */
  const onTilePromise = <A,>(
    e: MouseEvent,
    run: () => Promise<A>,
  ): Promise<A> => {
    e.stopPropagation();
    store.setActiveSilently(props.id);
    return run();
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
      <Show when={meta()?.agents}>
        {(agents) => (
          <AgentProfileChip
            profile={agents().profile}
            bundle={agents().bundle}
            buttonClass={TILE_BUTTON_CLASS}
            staleness={staleness()}
            // Same select-first wiring as the theme pill; the profile for
            // NEW terminals is changed in Settings → Agents.
            onClick={(e) => onTile(e, openSettings)}
            restart={restartOffer()}
          />
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
      <Show when={live()}>
        <Tip label={subCount() > 0 ? "Toggle split" : "Add split"}>
          <button
            type="button"
            data-testid="tile-split-toggle"
            class={`${TILE_BUTTON_CLASS} gap-1 px-1.5`}
            classList={{ "bg-black/20": splitExpanded() }}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              onTileAction(e, "toggle split", () =>
                crud.toggleSubPanel(props.id),
              )
            }
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
        <Tip label={ACTIONS.findInTerminal.label}>
          <button
            type="button"
            data-testid="tile-find"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => onTile(e, () => search.openFor(props.id))}
            aria-label={ACTIONS.findInTerminal.label}
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
            onTileAction(e, "screenshot terminal", () =>
              screenshotTerminal(props.id, meta()),
            )
          }
          title={ACTIONS.screenshotTerminal.label}
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
            onClick={(e) =>
              onTileAction(e, "sleep terminal", () =>
                crud.requestSleep(props.id),
              )
            }
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
          onClick={(e) =>
            onTileAction(e, "wake terminal", () => crud.handleWake(props.id))
          }
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
