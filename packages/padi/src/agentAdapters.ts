/**
 * THE list of agent adapters padi runs, and the pre-session question that can be
 * asked of it.
 *
 * The four adapters used to be named twice — once where the sensors start them,
 * and again wherever anything else wanted to know what an agent looks like. They
 * are listed once here, and `sensors.ts` iterates this list rather than spelling
 * its own copy, so an integration is wired by joining ONE array.
 *
 * ## Why a command-name question exists at all
 *
 * An adapter recognizes a *session*, and a session is a conversation: Claude
 * Code and grok write the transcript this detection reads only once the FIRST
 * message has been submitted. So for a freshly spawned agent sitting at its
 * prompt, `snapshotFor(id).agent` is null and `wait_agentState` reports no bucket
 * — the agent is plainly there on screen, and padi cannot see it yet.
 *
 * That is fine for every consumer that asks "what is this agent doing", because
 * by then there is a conversation to describe. It is fatal for the one consumer
 * that asks "is an agent ready to be TYPED INTO", which by construction runs
 * before the first message exists — padi's first-message readiness shipped
 * keyed on session recognition and refused every real spawn-and-brief for 30
 * seconds (field report, 2026-08-19).
 *
 * The process name is the identity that exists in between: kaval reads it off
 * the pty's foreground process, `kolu ls` prints it in FOREGROUND, and it is
 * there the moment the shell execs the agent — long before any transcript. This
 * module is where the two identities meet, and {@link isKnownAgentCommand} is
 * the only honest way to ask the earlier one.
 */

import { claudeCodeAdapter } from "kolu-claude-code";
import { codexAdapter } from "kolu-codex";
import { grokAdapter } from "kolu-grok";
import { opencodeAdapter } from "kolu-opencode";

/** Every agent padi detects, in no significant order. Adding an integration is
 *  one entry here — the sensors start what this lists, and the command-name
 *  question below answers over the same set, so neither can miss one.
 *
 *  Deliberately UNANNOTATED (`as const`): the adapters are heterogeneous in their
 *  `Session`/`Info` parameters, and a hand-written element type over both would
 *  have to be `any` to hold them. Inference keeps each entry's real type, so the
 *  reads below stay checked and `startAgent` still sees a concrete adapter. */
// Re-exported so this module is the ONE import site for the integrations:
// whatever starts them imports from here, beside the list, rather than reaching
// past it to four packages. (What that does not do is force the two to agree —
// `startAgent` is generic per adapter and cannot be mapped over a heterogeneous
// tuple, so the sensors still name their four. Colocation is the guard.)
export { claudeCodeAdapter, codexAdapter, grokAdapter, opencodeAdapter };

export const AGENT_ADAPTERS = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  grokAdapter,
] as const;

/** The executable names those adapters run as — `claude`, `codex`, … */
export const AGENT_COMMAND_NAMES: ReadonlySet<string> = new Set(
  AGENT_ADAPTERS.map((a) => a.commandName),
);

/** Is `name` the executable name of an agent padi knows?
 *
 *  `name` is a pty foreground process name (kaval's `foregroundProcess`, the
 *  FOREGROUND column). Answers `false` for `undefined`, for a shell, and for
 *  anything else — the negative bias every readiness question here takes, and
 *  the reason a bare `bash` is still refused a first message.
 *
 *  This is deliberately NOT "is an agent ready": a process that exists may still
 *  be painting. It is the half that says an agent is RUNNING here at all, and
 *  its caller pairs it with output quiescence. */
export function isKnownAgentCommand(name: string | undefined | null): boolean {
  return name !== undefined && name !== null && AGENT_COMMAND_NAMES.has(name);
}
