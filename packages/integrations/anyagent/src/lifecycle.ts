/** Shared lifecycle helpers used by every agent integration's state
 *  derivation. Lives here so the *policy* (e.g. "how does a mixed batch
 *  of pending tool calls map to a state?") has one home, even though
 *  the *detection mechanics* (parsing JSONL content blocks vs. JSONL
 *  function_call entries vs. SQLite tool parts) are necessarily
 *  per-integration. */

/** Decide between `tool_use` and `awaiting_user` given how many pending
 *  tool invocations are awaiting-user-flavored vs. how many are pending
 *  in total.
 *
 *  Rule: only emit `awaiting_user` when *every* pending invocation is
 *  awaiting-user. A mixed batch (e.g. Claude calls `AskUserQuestion`
 *  alongside a `Read`) stays `tool_use` because real compute is in
 *  flight — pretending the UI is just "awaiting" would hide that. The
 *  conservative bucket wins.
 *
 *  Single-source-of-truth so a future policy change (e.g. "show
 *  awaiting_user even in mixed batches, the human gate is the
 *  bottleneck") touches one site instead of N. */
export function classifyByAwaiting(
  awaiting: number,
  total: number,
): "tool_use" | "awaiting_user" {
  return total > 0 && awaiting === total ? "awaiting_user" : "tool_use";
}
