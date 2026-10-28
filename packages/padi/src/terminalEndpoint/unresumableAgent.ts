/** The loud half of a terminal that will not resume across a restart.
 *
 *  A terminal can hold a LIVE agent identity (an adapter matched the foreground
 *  process and its session file) while kolu cannot render a resume form for it —
 *  the agent's `kind` is not one this build knows, or its captured resume ref no
 *  longer matches the agent's own shape gate. Such a terminal's wake lands on a
 *  bare shell. That used to happen in silence; this names it once in padi's log.
 *
 *  It lives at the endpoint's fold loop because that is the one place both facts
 *  meet: the folded state (which the pure fold cannot log from) and the raw
 *  command mark, kept only as LOG CONTEXT. The mark itself is never parsed into a
 *  command any more — PTY output is a sensor, so it can explain an odd detection
 *  but never decide one.
 *
 *  (Before restore was rendered from structured facts, the common cause was an
 *  unreadable launch LINE — a pipeline, `cd x && agent`, `env -i agent`. That
 *  cause is gone: the resume target comes from the session identity and the live
 *  process's argv, not from the mark.) */

import type { TerminalId, TerminalState } from "@kolu/terminal-vocab/schema";
import { resumeFormFor } from "kolu-agents/vocab";
import type { Logger } from "pino";
import { restoreTargetOf } from "../terminalWorkspace/fold.ts";

export interface UnresumableAgentWatch {
  /** Remember the latest raw command line the terminal's shell reported — for the
   *  warning's context only. Never parsed. */
  noteRawCommand(raw: string): void;
  /** Check a freshly folded state; warns at most once per agent episode. */
  check(state: TerminalState): void;
}

/** One watch per terminal sensor run. An "episode" ends when the agent leaves
 *  (`snapshot.agent` back to null), so a later unresumable agent in the same
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
    check(state) {
      if (state.snapshot.agent === null) {
        warned = false;
        return;
      }
      if (warned || resumeFormFor(restoreTargetOf(state)) !== null) return;
      warned = true;
      log.warn(
        {
          terminal: id,
          agent: state.snapshot.agent.kind,
          reason: "no-resume-form",
          // Why it refused: an unknown kind, or a ref that failed its shape gate.
          resumeRef: state.snapshot.agent.sessionId,
          lastRawCommand,
        },
        "agent detected but kolu cannot render a resume form for it — this terminal will not resume across restart",
      );
    },
  };
}
