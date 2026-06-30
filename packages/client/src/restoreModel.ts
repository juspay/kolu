/** Pure restore-card model — which saved top-level terminals will RESUME their
 *  agent when the session is restored.
 *
 *  Resumability is read off the fold-derived `restoreTarget`, NOT a sticky
 *  `lastAgentCommand`: a terminal that ran an agent and then quit to a shell keeps
 *  its `lastAgentCommand` (the last launch line) but carries `restoreTarget: none`,
 *  and wake brings back a bare shell — counting it would make the card promise a
 *  resume that won't happen. Only `exact` (resume the exact conversation) and
 *  `legacyMostRecent` (migrated pre-1.29 most-recent) actually relaunch an agent.
 *
 *  A SLEEPING saved record restores DORMANT: `useSessionRestore` seeds it with no
 *  PTY spawn and no agent resume (the user wakes it later), so it is NOT resumable
 *  here even if its target would resume. Sub-terminals (parented) never resume
 *  independently. */

import { resumableCommand, type SavedTerminal } from "kolu-common/surface";

export function resumableTerminalIds(
  terminals: readonly SavedTerminal[],
): string[] {
  return terminals
    .filter(
      (t) =>
        !t.parentId &&
        t.state !== "sleeping" &&
        resumableCommand(t.restoreTarget) !== null,
    )
    .map((t) => t.id);
}
