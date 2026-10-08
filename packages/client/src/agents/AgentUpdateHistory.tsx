/** The History disclosure under Settings' Agents status lines: each machine's
 *  last update events, one row per event — the machine, when, and what
 *  happened in the updater's own words (a failure in the warning colour).
 *  Folded until asked for. The words wrap rather than truncate: they are what
 *  the row is for. The rows and their words are
 *  `agentUpdateHistoryRows`'s. */

import { type Component, For, Show } from "solid-js";
import {
  AGENTS_HISTORY,
  type AgentUpdateHistoryRow,
} from "@kolu/agent-distro/status";
import Disclosure from "../ui/Disclosure";

const AgentUpdateHistory: Component<{
  rows: readonly AgentUpdateHistoryRow[];
}> = (props) => (
  <Disclosure
    summary={AGENTS_HISTORY.title(props.rows.length)}
    data-testid="agents-history"
  >
    <Show
      when={props.rows.length > 0}
      fallback={
        <span
          data-testid="agents-history-empty"
          class="font-mono text-[0.7rem] text-fg-3/70"
        >
          {AGENTS_HISTORY.empty}
        </span>
      }
    >
      <div class="grid grid-cols-[6.5rem_4.5rem_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1 text-xs">
        <For each={props.rows}>
          {(row) => (
            <>
              {/* The host in the status line's host weight, the time muted,
                  the words between: each row has an anchor. */}
              <span
                data-testid="agents-history-host"
                class="truncate font-sans font-medium text-fg-2"
              >
                {row.host}
              </span>
              <span class="font-mono text-[0.7rem] text-fg-3/50">
                {row.when}
              </span>
              <span
                data-testid="agents-history-row"
                data-kind={row.kind}
                class="break-words font-mono text-[0.7rem]"
                classList={{
                  "text-warning": row.tone === "warn",
                  "text-fg-3": row.tone === "muted",
                }}
              >
                {row.text}
              </span>
            </>
          )}
        </For>
      </div>
    </Show>
  </Disclosure>
);

export default AgentUpdateHistory;
