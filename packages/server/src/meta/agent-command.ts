/**
 * Per-terminal stash of the most recently observed agent-CLI launch,
 * plus fan-out to the global recent-agents MRU. Driven by the
 * `commandRun` publisher channel — the PTY layer emits raw OSC 633;E
 * payloads and stays ignorant of agent semantics.
 *
 * The stash is consumed by `meta/agent.ts`'s `snapshotTerminalState`
 * so that interpreter-shimmed launches (npm-installed `codex` → `node`
 * kernel basename) still match the right provider. The stash is only
 * meaningful while a foreground command is running; the consumer gates
 * on `shellIdle` before reading.
 */
import type { TerminalId } from "kolu-common";
import { parseAgentCommand } from "anyagent";
import { subscribeForTerminal } from "../publisher.ts";
import { trackRecentAgent } from "../activity.ts";

const stash = new Map<TerminalId, string | null>();

/** Basename of the agent binary last observed in `terminalId`'s preexec
 *  stream, or null if none. Valid only while the shell is actively running
 *  a command — see `shellIdle` gate in `meta/agent.ts`. */
export function getLastAgentCommandName(terminalId: TerminalId): string | null {
  return stash.get(terminalId) ?? null;
}

/** Subscribe to the terminal's `commandRun` channel and, for each payload,
 *  parse it as an agent command, update the per-terminal stash, and push
 *  normalized invocations to the recent-agents MRU. Commands that aren't
 *  agents clear the stash. Returns a cleanup function that tears down the
 *  subscription and drops the stash entry. */
export function startAgentCommandTracker(terminalId: TerminalId): () => void {
  stash.set(terminalId, null);
  const abort = new AbortController();
  subscribeForTerminal("commandRun", terminalId, abort.signal, (raw) => {
    const normalized = parseAgentCommand(raw);
    stash.set(terminalId, normalized?.split(" ")[0] ?? null);
    if (normalized) trackRecentAgent(normalized);
  });
  return () => {
    abort.abort();
    stash.delete(terminalId);
  };
}
