/** Pure restore-card model — which saved top-level terminals will RESUME their
 *  agent when the session is restored.
 *
 *  A SLEEPING saved record restores DORMANT: `useSessionRestore` seeds it with no
 *  PTY spawn and no agent resume (the user wakes it later), so it is NOT resumable
 *  here even though it carries a `lastAgentCommand` on its persisted base. Counting
 *  it would inflate the restore card's "resume N agents" and imply an agent
 *  relaunches on restore when it does not. Sub-terminals (parented) never resume
 *  independently. */

import type { SavedTerminal } from "kolu-common/surface";

export function resumableTerminalIds(
  terminals: readonly SavedTerminal[],
): string[] {
  return terminals
    .filter(
      (t) =>
        !t.parentId &&
        t.state !== "sleeping" &&
        t.lastAgentCommand !== undefined,
    )
    .map((t) => t.id);
}
