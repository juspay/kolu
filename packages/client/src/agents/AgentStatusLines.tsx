/** The per-host status lines under Settings' Agents row: one line per machine
 *  (this one first, then each remote that is not ready), as a three-column grid
 *  — the host with agent-distro's mark, a thin bar, and a short mono text. The
 *  bar wears the state's colour: accent while downloading, ok when ready,
 *  warning when failed, empty before the host answers. Which lines show, and
 *  their collapse into one when every host is ready, is `agentStatusLines`. */

import { type Component, For } from "solid-js";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import type { AgentStatusLine } from "@kolu/agent-distro/status";

const BAR_FILL: Record<AgentStatusLine["bar"], string> = {
  busy: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warning",
  empty: "",
};

const AgentStatusLines: Component<{ lines: readonly AgentStatusLine[] }> = (
  props,
) => (
  <div
    data-testid="agents-status-lines"
    class="mt-2 grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-2.5 gap-y-1.5 text-xs"
  >
    <For each={props.lines}>
      {(line) => (
        <>
          <span
            data-testid="agents-status-host"
            class="flex min-w-0 items-center gap-1.5 font-medium text-fg-2"
          >
            <AgentDistroLogo size={12} />
            <span class="truncate">{line.host}</span>
          </span>
          <span class="h-[5px] overflow-hidden rounded-[3px] bg-edge">
            <span
              class={`block h-full ${BAR_FILL[line.bar]}`}
              style={{ width: `${line.fill * 100}%` }}
            />
          </span>
          <span
            data-testid="agents-status-text"
            data-bar={line.bar}
            title={line.text}
            class={`max-w-[14rem] truncate font-mono text-[0.7rem] ${line.bar === "warn" ? "text-warning" : "text-fg-3"}`}
          >
            {line.text}
          </span>
        </>
      )}
    </For>
  </div>
);

export default AgentStatusLines;
