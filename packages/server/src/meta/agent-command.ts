/**
 * Per-terminal tracking of the most recently observed agent-CLI launch,
 * plus fan-out to the global recent-agents MRU. Driven by the
 * `commandRun` publisher channel — the PTY layer emits raw OSC 633;E
 * payloads and stays ignorant of agent semantics.
 *
 * Two pieces of state are tracked independently:
 *
 *   - `currentAgent` — basename of the binary running in the foreground
 *     right now, cleared when the user types a non-agent command.
 *     Ephemeral (never persisted). Read by `meta/agent.ts`'s provider
 *     matcher to correlate the PTY foreground process with the right
 *     agent provider (codex often runs under the `node` kernel
 *     basename via npm shim, so we can't match on process name alone).
 *     Held in a module-local `Map` because it doesn't ride to disk.
 *   - `lastAgentCommand` — full normalized invocation of the most
 *     recent *agent* command in this terminal, preserved across
 *     intervening non-agent input. Lives on `TerminalMetadata` so the
 *     session snapshotter picks it up automatically and the restore
 *     UI's resume offer is driven by the same data every client sees.
 *
 * The two have different lifetimes by design: the first answers "what
 * is this terminal running *now*", the second answers "what is this
 * terminal *for*."
 */

import { parseAgentCommand } from "anyagent";
import type { TerminalId } from "kolu-common";
import { trackRecentAgent } from "../activity.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { getTerminal } from "../terminals.ts";
import { updateServerMetadata } from "./index.ts";

const currentAgent = new Map<TerminalId, string | null>();

/** Basename of the agent binary running in the foreground of
 *  `terminalId` right now, or null if the most recent command was not
 *  an agent. Consumed by `meta/agent.ts` to steer provider matching. */
export function getLastAgentCommandName(terminalId: TerminalId): string | null {
  return currentAgent.get(terminalId) ?? null;
}

/** Subscribe to the terminal's `commandRun` channel and, for each payload,
 *  parse it as an agent command, update the two state slots, and push
 *  normalized invocations to the recent-agents MRU. Returns a cleanup
 *  function that tears down the subscription and drops the ephemeral
 *  `currentAgent` entry (the persisted `lastAgentCommand` on metadata
 *  goes away with the terminal). */
export function startAgentCommandTracker(terminalId: TerminalId): () => void {
  currentAgent.set(terminalId, null);
  const abort = new AbortController();
  subscribeForTerminal("commandRun", terminalId, abort.signal, (raw) => {
    const normalized = parseAgentCommand(raw);
    currentAgent.set(terminalId, normalized?.split(" ")[0] ?? null);
    if (normalized) {
      const entry = getTerminal(terminalId);
      // Gate on actual value change — otherwise re-invoking the same
      // agent (`claude --model sonnet` twice in a row) would refire
      // the metadata publish + session auto-save on every command.
      if (entry && entry.info.meta.lastAgentCommand !== normalized) {
        updateServerMetadata(entry, terminalId, (m) => {
          m.lastAgentCommand = normalized;
        });
      }
      trackRecentAgent(normalized);
    }
  });
  return () => {
    abort.abort();
    currentAgent.delete(terminalId);
  };
}
