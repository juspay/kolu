/** GitHub PR metadata — schemas + helpers.
 *
 *  Lives in its own module (exposed as `kolu-common/pr`) so clients can
 *  runtime-import `prValue` / `prUnavailableReason` without dragging the
 *  full kolu-common module graph — which re-exports kolu-claude-code and
 *  transitively pulls `@anthropic-ai/claude-agent-sdk` (a Node-only package)
 *  into the browser bundle. */

import { z } from "zod";

export const GitHubCheckStatusSchema = z.enum(["pending", "pass", "fail"]);

export const GitHubPrStateSchema = z.enum(["open", "closed", "merged"]);

export const GitHubPrInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** PR state: open, closed, or merged. */
  state: GitHubPrStateSchema,
  /** Combined CI status: pending, pass, or fail. Null if no checks configured. */
  checks: GitHubCheckStatusSchema.nullable(),
});
export type GitHubPrInfo = z.infer<typeof GitHubPrInfoSchema>;

/** PR resolution state.
 *
 *  Decomplects distinct conditions that `GitHubPrInfo | null` used to
 *  collapse into one value:
 *    pending     — resolver is running (or stale after a branch change)
 *    ok          — resolver succeeded; a PR exists for this branch
 *    absent      — resolver succeeded; no PR for this branch (expected case)
 *    unavailable — resolver couldn't run (gh missing, not authenticated, timed out)
 *
 *  The UI needs to distinguish "absent" (nothing to show) from "unavailable"
 *  (show a warning with `reason`). Keeping the provenance in the same field
 *  as the value avoids a sibling-flag invariant.
 *
 *  Analogous schemas for git/agent/foreground are not introduced yet — their
 *  failure modes don't currently surface as user-actionable warnings. If they
 *  do, mirror this shape per-provider rather than inventing a cross-cutting
 *  status registry (see PR description for #148). */
export const PrResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ok"), value: GitHubPrInfoSchema }),
  z.object({ kind: z.literal("absent") }),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type PrResult = z.infer<typeof PrResultSchema>;

/** Extract the `GitHubPrInfo` when `kind === "ok"`, else `null`.
 *  Lets SolidJS `<Show when={prValue(meta.pr)}>` work without tripping on the
 *  object-truthy trap (every variant is a non-null object). */
export function prValue(pr: PrResult): GitHubPrInfo | null {
  return pr.kind === "ok" ? pr.value : null;
}

/** Extract the unavailability reason when `kind === "unavailable"`, else `null`. */
export function prUnavailableReason(pr: PrResult): string | null {
  return pr.kind === "unavailable" ? pr.reason : null;
}
