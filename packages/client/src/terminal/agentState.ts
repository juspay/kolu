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

export type AttentionState = "waiting" | "awaiting_user";

/** True when the agent state belongs to the alert/notify class above. Type
 *  predicate so consumers can narrow `AgentInfo["state"]` to `AttentionState`.
 *
 *  Accepts `string | undefined` because callers reading from reactive history
 *  (`createEffect`'s previous-value tracking) lose the literal type — equality
 *  comparisons inside still narrow correctly. */
export function isAttentionState(
  state: string | undefined,
): state is AttentionState {
  return state === "waiting" || state === "awaiting_user";
}
