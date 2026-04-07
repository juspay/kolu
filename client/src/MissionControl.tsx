/**
 * Mission Control — sticky horizontal strip showing live previews of agent terminals.
 *
 * Renders between the header and the main sidebar+terminal flex when the user has
 * toggled it on. Defaults to showing only terminals running code agents
 * (`metadata.claude != null`); a chevron at the bottom toggles to show all terminals.
 * Both visibility and filter mode are persisted server-side via Preferences.
 */

import { type Component, For, Show, createMemo } from "solid-js";
import TerminalPreview from "./TerminalPreview";
import TerminalMeta from "./TerminalMeta";
import { ChevronDownIcon, ChevronUpIcon } from "./Icons";
import Tip from "./Tip";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import type { ITheme } from "@xterm/xterm";

const MissionControl: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  getTerminalTheme: (id: TerminalId) => ITheme;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  /** Ids to render: agents only, or all, depending on showAll. */
  const visibleIds = createMemo(() =>
    props.showAll
      ? props.terminalIds
      : props.terminalIds.filter((id) => props.getMetadata(id)?.claude != null),
  );

  return (
    <div
      data-testid="mission-control"
      class="shrink-0 bg-surface-1 border-b border-edge flex flex-col"
    >
      <div class="flex-1 min-h-0 h-36 flex gap-2 px-3 py-2 overflow-x-auto">
        <Show
          when={visibleIds().length > 0}
          fallback={
            <div
              data-testid="mission-control-empty"
              class="flex-1 flex items-center justify-center text-fg-3 text-xs"
            >
              <Show
                when={props.showAll}
                fallback={
                  <span>
                    No code agents running.{" "}
                    <button
                      class="text-accent hover:underline cursor-pointer"
                      onClick={() => props.onShowAllChange(true)}
                    >
                      Show all terminals
                    </button>
                  </span>
                }
              >
                <span>No terminals open</span>
              </Show>
            </div>
          }
        >
          <For each={visibleIds()}>
            {(id) => (
              <button
                data-testid="mission-control-card"
                data-terminal-id={id}
                data-active={props.activeId === id ? "" : undefined}
                class="shrink-0 w-56 h-full flex flex-col bg-surface-0 rounded-lg overflow-hidden shadow-md shadow-black/30 hover:shadow-lg hover:shadow-black/40 transition-shadow cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 data-[active]:ring-2 data-[active]:ring-accent/70 text-left"
                onClick={() => props.onSelect(id)}
              >
                <div class="flex-1 min-h-0 w-full">
                  <TerminalPreview
                    terminalId={id}
                    theme={props.getTerminalTheme(id)}
                  />
                </div>
                <div class="px-2 py-1 bg-surface-1 border-t border-edge flex flex-col gap-0.5 h-14 shrink-0">
                  <TerminalMeta info={props.getDisplayInfo(id)} mode="normal" />
                </div>
              </button>
            )}
          </For>
        </Show>
      </div>
      <Tip
        label={props.showAll ? "Show only code agents" : "Show all terminals"}
      >
        <button
          data-testid="mission-control-expand"
          class="h-4 w-full flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-2 border-t border-edge cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => props.onShowAllChange(!props.showAll)}
        >
          <Show when={props.showAll} fallback={<ChevronDownIcon />}>
            <ChevronUpIcon />
          </Show>
        </button>
      </Tip>
    </div>
  );
};

export default MissionControl;
