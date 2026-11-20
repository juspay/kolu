import {
  agentRestartAction,
  agentRestartReady,
  agentStalenessOf,
} from "@kolu/agent-distro/status";
import { activeArm, sleepingArm } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import AgentProfileChip, { type ChipRestart } from "../agents/AgentProfileChip";
import {
  agentDistroSetting,
  agentsWhere,
  hostAgentStatusOf,
} from "../agents/useAgentDistro";
import { ACTIONS } from "../input/actions";
import { armComposerMention } from "../conductor/drafts";
import { enterConductorMode } from "../conductor/useConductorMode";
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
  RestartIcon,
  ScreenshotIcon,
  SearchIcon,
  SplitToggleIcon,
} from "../ui/Icons";
import Tip from "../ui/Tip";
import { useCommandPalette } from "../useCommandPalette";
import { useThemeManager } from "../useThemeManager";

const TILE_BUTTON_CLASS =
  "flex items-center justify-center h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

type SyncChrome<T> = (() => T) &
  (T extends void
    ? unknown
    : "this callback returns a value — an Effect goes to onTileAction, a Promise to onTilePromise");

const TileTitleActions: Component<{
  id: TerminalId;
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
  const live = () => activeArm(meta());
  const sleeping = () => sleepingArm(meta()) !== undefined;
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
  const restartOffer = (): ChipRestart | undefined => {
    const s = staleness();
    if (s.kind !== "stale" || !agentRestartReady(s)) return undefined;
    return {
      guarded: crud.liveAgentOf(props.id),
      action: agentRestartAction(s),
      run: (e) =>
        onTilePromise(e, () => runActionPromise(crud.handleRestart(props.id))),
    };
  };
  const themeName = () => getTerminalThemeName(props.id);
  const subCount = () => store.getDisplayInfo(props.id)?.subCount ?? 0;
  const splitExpanded = () =>
    subCount() > 0 && !subPanel.savedSplit(props.id).collapsed;
  const restartArmed = () => crud.restartArmed(props.id);
  const restartBusy = () => crud.restartBusy(props.id);
  const restartLabel = () =>
    restartArmed()
      ? "Press again to restart — this ends the live agent"
      : "Restart terminal";

  const onTile = <T,>(e: MouseEvent, fn: SyncChrome<T>) => {
    e.stopPropagation();
    store.setActiveSilently(props.id);
    (fn as () => T)();
  };

  const onTileAction = (
    e: MouseEvent,
    label: string,
    action: () => UiAction,
  ) => {
    onTile(e, () => {
      runAction(label, action());
    });
  };

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
            agents={agents()}
            buttonClass={TILE_BUTTON_CLASS}
            staleness={staleness()}
            where={agentsWhere(props.host)}
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
        <Tip label="Ask the Conductor about this">
          <button
            type="button"
            data-testid="tile-ask-conductor"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              onTile(e, () => {
                const name = store.getDisplayInfo(props.id)?.key.label;
                if (name !== undefined) armComposerMention(name);
                enterConductorMode();
              })
            }
            aria-label="Ask the Conductor about this"
          >
            ◆
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
        <Tip label={restartLabel()}>
          <button
            type="button"
            data-testid="tile-restart"
            data-armed={restartArmed() ? "" : undefined}
            class={`${TILE_BUTTON_CLASS} w-7`}
            classList={{
              "bg-warning/15": restartArmed(),
              "opacity-50 cursor-wait": restartBusy(),
            }}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            disabled={restartBusy()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              onTile(e, () => {
                showTipOnce(CONTEXTUAL_TIPS.restartTerminal);
                crud.requestRestart(props.id);
              })
            }
            aria-label={restartLabel()}
          >
            <RestartIcon />
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
