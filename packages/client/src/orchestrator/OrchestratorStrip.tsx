/** The strip above the scroll: which tool servers this conversation has, and
 *  what is still out.
 *
 *  It sits ABOVE the transcript rather than in it because both facts outlive the
 *  rows that announced them — a background task armed an hour ago is still
 *  running, and its row is an hour of scrollback away. Pressing one jumps to
 *  that row rather than restating it here.
 *
 *  The tick is the AGENT'S word, and only its word: `connected` is the agent
 *  reporting the server attached, and the three other standings each say their
 *  own thing instead of borrowing it. A `missing` server is a probe's no that
 *  the agent cannot overwrite, so it carries the prober's sentence verbatim. */

import type { OrchestratorState } from "@kolu/padi-client/orchestrator";
import { type Component, For, Show } from "solid-js";
import { getClockNow } from "../time/clock";
import { formatElapsedShort } from "../time/duration";
import Tip from "../ui/Tip";

const STANDING_CLASS: Record<string, string> = {
  connected: "text-ok",
  handed: "text-fg-2",
  unattached: "text-attention",
  missing: "text-danger",
};

const OrchestratorStrip: Component<{
  servers: OrchestratorState["servers"];
  watching: OrchestratorState["watching"];
  /** Reveal the transcript row a watched task or subagent belongs to. */
  onReveal: (rowId: string) => void;
}> = (props) => {
  const now = getClockNow();
  const since = (stamp: string): string => {
    const at = Date.parse(stamp);
    return Number.isNaN(at) ? "" : formatElapsedShort(Math.max(0, now() - at));
  };

  return (
    <Show
      when={props.servers.length > 0 || props.watching.length > 0}
      // ABSENT, not empty: a strip with nothing in it is a band of padding that
      // says a conversation has no tools, which is a different claim.
    >
      <div
        data-testid="orchestrator-strip"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-1.5 border-b border-edge font-mono text-[0.68rem] text-fg-2"
      >
        <For each={props.servers}>
          {(server) => (
            <Tip label={server.said ?? server.where ?? server.standing}>
              <span
                data-testid="orchestrator-server"
                data-server={server.name}
                data-standing={server.standing}
                class={`font-semibold ${STANDING_CLASS[server.standing] ?? "text-fg-2"}`}
              >
                {server.name}
                {server.standing === "connected" ? " ✓" : ""}
                <Show when={server.standing === "missing" && server.said}>
                  {(said) => (
                    <span class="font-normal text-fg-3"> · {said()}</span>
                  )}
                </Show>
              </span>
            </Tip>
          )}
        </For>
        <Show when={props.servers.length > 0}>
          {/* The agent brings its own servers and we never handed them, so the
              roster says so rather than inventing rows for them. */}
          <span class="text-fg-3">· plus the agent's own</span>
        </Show>
        <For each={props.watching}>
          {(out) => (
            <button
              type="button"
              data-testid="orchestrator-watching"
              data-kind={out.kind}
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-px cursor-pointer"
              classList={{
                "border-busy/45 text-busy": out.kind === "task",
                "border-edge-bright text-fg-2": out.kind === "agent",
              }}
              onClick={() => props.onReveal(out.row)}
            >
              <span>{out.kind === "task" ? "●" : "⤷"}</span>
              <span class="truncate max-w-[16rem]">{out.name}</span>
              <span class="text-fg-3">· {since(out.since)}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default OrchestratorStrip;
