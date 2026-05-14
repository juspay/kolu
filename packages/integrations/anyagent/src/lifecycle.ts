/** Shared lifecycle helpers across the per-integration state derivers.
 *  Detection mechanics differ (Claude JSONL content blocks vs. Codex
 *  function_call entries vs. OpenCode SQLite tool parts) but the policy
 *  decisions they make live here. */

/** Pick `awaiting_user` over `tool_use` only when *every* pending tool
 *  invocation is awaiting-user-flavored. A mixed batch — e.g. Claude
 *  calls `AskUserQuestion` alongside a `Read` — stays `tool_use`
 *  because real compute is in flight; flipping to `awaiting_user`
 *  would hide that. Centralized so the policy has one home for a
 *  future change ("the human gate is the bottleneck, show
 *  awaiting_user even in mixed batches") to touch. */
export function classifyByAwaiting(
  awaiting: number,
  total: number,
): "tool_use" | "awaiting_user" {
  return total > 0 && awaiting === total ? "awaiting_user" : "tool_use";
}
