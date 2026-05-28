/** Agent-state predicates — domain-level rules over `AgentInfo["state"]`.
 *
 *  Two equivalence classes carved over the same union, both used by
 *  multiple consumers and otherwise prone to drifting apart:
 *
 *  - **Attention** (`waiting` | `awaiting_user`): agent is blocked on the
 *    user. Drives the dock's `awaiting` row variant, the OS-badge gate
 *    (firing condition only — staleness still suppresses the badge), and
 *    the activity-alert fire criterion. A new state joining this class
 *    must land here so every consumer picks it up.
 *  - **Working** (`thinking` | `tool_use` | `running_background`): compute is
 *    in flight (locally, or in a background task this agent is waiting on).
 *    Drives the dock's `working` row variant.
 *
 *  `agentBucket` (in `canvas/dockModel.ts`) used to repeat both literal
 *  lists in a `match`/`.exhaustive()` block; it now consumes these
 *  predicates so the membership rule lives in exactly one place. The
 *  `satisfies never` at the agentBucket fall-through keeps exhaustiveness
 *  intact — any future state literal added to `AgentInfo["state"]` will
 *  compile-fail there until it lands in one of these predicates.
 */

export type AttentionState = "waiting" | "awaiting_user";
export type WorkingState = "thinking" | "tool_use" | "running_background";

/** True when the agent state means "user action needed now". Type
 *  predicate so consumers can narrow `AgentInfo["state"]` to
 *  `AttentionState` and skip subsequent re-checks.
 *
 *  Accepts `string | undefined` because callers reading from reactive
 *  history (`createEffect`'s previous-value tracking) lose the literal
 *  type — equality comparisons inside still narrow correctly. */
export function isAttentionState(
  state: string | undefined,
): state is AttentionState {
  return state === "waiting" || state === "awaiting_user";
}

/** True when the agent is actively computing. Counterpart to
 *  `isAttentionState`; together they partition the live agent states. */
export function isWorkingState(
  state: string | undefined,
): state is WorkingState {
  return (
    state === "thinking" ||
    state === "tool_use" ||
    state === "running_background"
  );
}
