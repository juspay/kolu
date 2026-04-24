/**
 * Per-terminal stash of the most recently observed agent-CLI launch,
 * plus fan-out to the global recent-agents MRU. Driven by the
 * `commandRun` publisher channel — the PTY layer emits raw OSC 633;E
 * payloads and stays ignorant of agent semantics.
 *
 * Two pieces of state are tracked independently:
 *
 *   - `currentAgent` — basename of the binary running in the foreground
 *     right now, cleared when the user types a non-agent command. Read
 *     by `meta/agent.ts`'s provider matcher to correlate the PTY
 *     foreground process with the right agent provider (codex often
 *     runs under the `node` kernel basename via npm shim, so we can't
 *     match on process name alone).
 *   - `lastAgentCommand` — full normalized invocation of the most
 *     recent *agent* command in this terminal, preserved across
 *     intervening non-agent input. Read by `terminals.ts`'s session
 *     snapshotter to embed into `SavedTerminal.lastAgentCommand` for
 *     the restore UI's resume offer. Cleared only on terminal exit.
 *
 * The two have different lifetimes by design: the first answers "what
 * is this terminal running *now*", the second answers "what is this
 * terminal *for*."
 */
import type { TerminalId } from "kolu-common";
import { parseAgentCommand } from "anyagent";
import { subscribeForTerminal } from "../publisher.ts";
import { trackRecentAgent } from "../activity.ts";

const currentAgent = new Map<TerminalId, string | null>();
const lastAgentCommand = new Map<TerminalId, string>();

/** Basename of the agent binary running in the foreground of
 *  `terminalId` right now, or null if the most recent command was not
 *  an agent. Consumed by `meta/agent.ts` to steer provider matching. */
export function getLastAgentCommandName(terminalId: TerminalId): string | null {
  return currentAgent.get(terminalId) ?? null;
}

/** Full normalized agent CLI invocation last observed in `terminalId`
 *  (e.g. `"claude --model sonnet"`), or null if no agent has ever run
 *  there. Preserved across intervening non-agent input so the restore
 *  offer survives a `ls` or `git status` between agent sessions. */
export function getLastAgentCommand(terminalId: TerminalId): string | null {
  return lastAgentCommand.get(terminalId) ?? null;
}

/** Subscribe to the terminal's `commandRun` channel and, for each payload,
 *  parse it as an agent command, update the two stashes, and push
 *  normalized invocations to the recent-agents MRU. Returns a cleanup
 *  function that tears down the subscription and drops both stash
 *  entries. */
export function startAgentCommandTracker(terminalId: TerminalId): () => void {
  currentAgent.set(terminalId, null);
  const abort = new AbortController();
  subscribeForTerminal("commandRun", terminalId, abort.signal, (raw) => {
    const normalized = parseAgentCommand(raw);
    currentAgent.set(terminalId, normalized?.split(" ")[0] ?? null);
    if (normalized) {
      lastAgentCommand.set(terminalId, normalized);
      trackRecentAgent(normalized);
    }
  });
  return () => {
    abort.abort();
    currentAgent.delete(terminalId);
    lastAgentCommand.delete(terminalId);
  };
}
