/** The agent-state ATTENTION class — the one equivalence class the terminal
 *  ALERT layer (`useTerminalAlerts`) fires on. An agent enters it when it
 *  either finishes its turn and yields (`waiting`) or actively blocks on the
 *  user (`awaiting_user`); crossing INTO the class is what fires the "your
 *  agent wants you" notification and OS badge (staleness still suppresses the
 *  badge). Folding the two states into one class means flipping between them
 *  within a session doesn't double-alert.
 *
 *  This is deliberately a DIFFERENT partition from the shared needs-you
 *  projection (`@kolu/terminal-workspace/agentProjection`, which the dock,
 *  pulam-tui, and pulam-web all rank by): there `waiting` is idle — a finished
 *  agent isn't asking you to act — but the alert layer still NOTIFIES on it,
 *  because a finished agent is worth a ping. "Notify me something happened" and
 *  "rank by what needs my action" are different questions, so they classify
 *  `waiting` differently, on purpose. */

import { type AgentInfo, agentBucket } from "kolu-common/surface";

export type AttentionState = "waiting" | "awaiting_user";

/** True when the agent state belongs to the alert/notify class above. Type
 *  predicate so consumers can narrow `AgentInfo["state"]` to `AttentionState`.
 *
 *  Membership rides the shared, compile-fenced closed set rather than a hand-
 *  listed pair of literals: an `awaiting_user`/`waiting` agent is exactly the
 *  one whose shared `agentBucket` is `awaiting` or `waiting`. A state rename in
 *  `AgentInfoSchema` then trips the projection's `satisfies never` fence (which
 *  reroutes the bucket) instead of silently leaving a now-dead string-equality
 *  here that quietly stops the notification firing.
 *
 *  Accepts `string | undefined` because callers reading from reactive history
 *  (`createEffect`'s previous-value tracking) lose the literal type — the
 *  bucket fold's own `default` arm handles an unknown string. */
export function isAttentionState(
  state: string | undefined,
): state is AttentionState {
  if (state === undefined) return false;
  const bucket = agentBucket(state as AgentInfo["state"]);
  return bucket === "awaiting" || bucket === "waiting";
}
