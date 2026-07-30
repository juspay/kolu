/**
 * Host-owned resumability fold — which saved terminals will resume an agent
 * when the session is restored.
 *
 * Resumability is read off the fold-derived `restoreTarget`, NOT a sticky
 * `lastAgentCommand`: a terminal that ran an agent and then quit to a shell keeps
 * its `lastAgentCommand` (the last launch line) but carries `restoreTarget: none`,
 * and wake brings back a bare shell — counting it would make the card promise a
 * resume that won't happen. Only `exact` (resume the exact conversation) and
 * `legacyMostRecent` (migrated pre-1.29 most-recent) actually relaunch an agent.
 *
 * A SLEEPING saved record restores DORMANT: no PTY spawn and no agent resume
 * (the user wakes it later), so it is NOT resumable here even if its target
 * would resume. Every ACTIVE record with a real target is resumable — including
 * parented terminals (splits / tree children). The client never constructs this
 * set; it only renders the host-served list and may subtract (user opt-out).
 */

import { resumableCommand } from "anyagent/schemas";
import type { SavedTerminal } from "../vocab.ts";

/** Ids of saved terminals that will resume an agent on restore (host-owned). */
export function resumableTerminalIds(
  terminals: readonly SavedTerminal[],
): string[] {
  return terminals
    .filter(
      (t) => t.state === "active" && resumableCommand(t.restoreTarget) !== null,
    )
    .map((t) => t.id);
}
