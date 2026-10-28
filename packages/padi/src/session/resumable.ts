/**
 * Host-owned resumability fold — which saved terminals will resume an agent
 * when the session is restored.
 *
 * Resumability is read off the fold-derived `restoreTarget` — there is no
 * remembered launch line any more. A terminal that ran an agent and then quit to a
 * shell carries `restoreTarget: none`, and wake brings back a bare shell — counting
 * it would make the card promise a resume that won't happen. Only `exact` (resume
 * the exact conversation, rendered from its identity + allowlisted flags) actually
 * relaunches an agent.
 *
 * A SLEEPING saved record restores DORMANT: no PTY spawn and no agent resume
 * (the user wakes it later), so it is NOT resumable here even if its target
 * would resume. Every ACTIVE record with a real target is resumable — including
 * parented terminals (splits / tree children). The client never constructs this
 * set; it only renders the host-served list and may subtract (user opt-out).
 */

import type { SavedTerminal } from "@kolu/padi-client/surface";
import { resumableCommand } from "kolu-agents/vocab";

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
