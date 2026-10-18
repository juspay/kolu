/** The loud half of an unrecognized launch line.
 *
 *  A terminal can hold a LIVE agent identity (an adapter matched the foreground
 *  process and its session file) while the fold remembers NO launch command —
 *  the 633;E line that started it was something `parseAgentCommand` could not
 *  read (a pipeline, `cd x && agent`, `env -i agent`). Such a terminal's restore
 *  target is `none`, so a kaval restart brings it back as a bare shell. That
 *  used to happen in silence; this names it once in padi's log.
 *
 *  It lives at the endpoint's fold loop because that is the one place both facts
 *  meet: the identity is in `snapshot.agent`, the command in `memory`, and the
 *  raw line only on the pty-host tap this endpoint bridges. The producer (the
 *  sensors) never sees the folded memory, and the fold itself is pure. */

import type { TerminalId, TerminalState } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";

export interface UnresumableAgentWatch {
  /** Remember the latest raw command line the terminal's shell reported. */
  noteRawCommand(raw: string): void;
  /** Check a freshly folded state; warns at most once per agent episode. */
  check(state: TerminalState): void;
}

/** One watch per terminal sensor run. An "episode" ends when the agent leaves
 *  (`snapshot.agent` back to null), so a later unrecognized launch in the same
 *  terminal warns again — but a long-running agent warns exactly once. */
export function unresumableAgentWatch(
  id: TerminalId,
  log: Pick<Logger, "warn">,
): UnresumableAgentWatch {
  let lastRawCommand: string | undefined;
  let warned = false;
  return {
    noteRawCommand(raw) {
      lastRawCommand = raw;
    },
    check({ snapshot, memory }) {
      if (snapshot.agent === null) {
        warned = false;
        return;
      }
      if (warned || memory.lastAgentCommand !== undefined) return;
      warned = true;
      log.warn(
        { terminal: id, agent: snapshot.agent.kind, lastRawCommand },
        "agent detected but its launch line was not recognized — this terminal will not resume across restart",
      );
    },
  };
}
