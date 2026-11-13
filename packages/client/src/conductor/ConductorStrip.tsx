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

import type { ConductorState } from "kolu-common/conductor";
import { type Component, For, Show } from "solid-js";
import { formatElapsedShort } from "../time/duration";
import Tip from "../ui/Tip";
import { useShownClock } from "./conductorShown";

// The three standings a row can hold, keyed by the union so a fourth one added
// to the schema fails the typecheck here rather than painting unstyled. There
// is no `missing`: a server kolu could not reach does not get a red row, it
// refuses the whole conversation (kolu-server's `ConductorUnavailable`), because an
// conductor that cannot reach the fleet is not a degraded conductor.
type Standing = ConductorState["servers"][number]["standing"];
const STANDING_CLASS: Record<Standing, string> = {
  connected: "text-ok",
  handed: "text-fg-2",
  unattached: "text-attention",
};

const ConductorStrip: Component<{
  servers: ConductorState["servers"];
  watching: ConductorState["watching"];
  /** Reveal the transcript row a watched task or subagent belongs to. */
  onReveal: (rowId: string) => void;
}> = (props) => {
  // Ages that stop while nobody is reading them — the pane is retained behind
  // a host tab, so this is `getClockNow` gated on `shown()`.
  const now = useShownClock();
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
        data-testid="conductor-strip"
        // `leading-4` for the same reason the header carries one: a LENGTH
        // line-height makes every child's line box 16px whatever its size, so
        // a bare word, a bordered pill and a `Tip`'s wrapper all centre on one
        // line instead of each striking its own.
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-1.5 border-b border-edge font-mono text-[0.68rem] leading-4 text-fg-2"
      >
        <For each={props.servers}>
          {(server) => (
            <Tip
              class="flex items-center"
              label={server.said ?? server.where ?? server.standing}
            >
              <span
                data-testid="conductor-server"
                data-server={server.name}
                data-standing={server.standing}
                class={`font-semibold ${STANDING_CLASS[server.standing]}`}
              >
                {server.name}
                {server.standing === "connected" ? " ✓" : ""}
                <Show when={server.standing === "unattached" && server.said}>
                  {/* The agent's own sentence about why it is not on this
                      server, beside the name — the one standing that carries a
                      quote worth reading without hovering for the tip. */}
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
              data-testid="conductor-watching"
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

export default ConductorStrip;
