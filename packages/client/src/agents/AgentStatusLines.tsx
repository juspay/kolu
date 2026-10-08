/** The per-host status lines under Settings' Agents row: one line per machine
 *  (this one first, then each remote that is not ready), as a three-column grid
 *  — the host with agent-distro's mark, a thin bar, and a short mono text. The
 *  bar wears the state's colour: accent while downloading, ok when ready,
 *  warning when failed, empty before the host answers — and full and green on
 *  a ready host even while it updates. A ready line's note — an update
 *  running, or the last one — sits under its text, quieter; a skip's or a
 *  failure's reason is in its hover. Which lines show, and
 *  their collapse into one when every host is ready, is `agentStatusLines`. */

import { type Component, For, Show } from "solid-js";
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
    class="mt-2 grid grid-cols-[7.5rem_minmax(2.5rem,1fr)_15.5rem] items-center gap-x-2.5 gap-y-1.5 text-xs"
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
          <span class="flex min-w-0 flex-col">
            <span
              data-testid="agents-status-text"
              data-bar={line.bar}
              data-update={line.update}
              data-last-run={line.lastRun}
              title={line.text}
              class={`truncate font-mono text-[0.7rem] ${line.bar === "warn" ? "text-warning" : "text-fg-3/70"}`}
            >
              {line.text}
            </span>
            <Show when={line.note}>
              {(note) => (
                <span
                  data-testid="agents-status-note"
                  data-tone={note().tone}
                  title={
                    note().detail === undefined
                      ? note().text
                      : `${note().text}: ${note().detail}`
                  }
                  class="truncate font-mono text-[0.65rem]"
                  classList={{
                    "text-fg-3/55": note().tone === "muted",
                    "text-warning": note().tone === "warn",
                  }}
                >
                  {note().text}
                </span>
              )}
            </Show>
          </span>
        </>
      )}
    </For>
  </div>
);

export default AgentStatusLines;
