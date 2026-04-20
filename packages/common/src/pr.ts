/** PR metadata — schemas + helpers.
 *
 *  Lives in its own module (exposed as `kolu-common/pr`) so clients can
 *  runtime-import helpers without dragging the full kolu-common module graph
 *  — which re-exports kolu-claude-code and transitively pulls
 *  `@anthropic-ai/claude-agent-sdk` (a Node-only package) into the browser
 *  bundle.
 *
 *  Provider tagging: the `unavailable` variant carries a `source` tagged by
 *  `provider` so a future bkt (Bitbucket CLI) resolver can contribute its own
 *  code namespace alongside gh's. `PrResult.ok`'s shape is still gh-specific
 *  (`GitHubPrInfoSchema`) because we don't yet know bkt's PR response shape;
 *  generalize when bkt's API dictates. See srid/agency#10. */

import { z } from "zod";
import { match } from "ts-pattern";

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

// --- gh-specific unavailable code ---

/** Typed gh-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler —
 *  rather than string-comparing display text and silently breaking on typo.
 *
 *  Named with the `Gh` prefix so a parallel `BktUnavailableCodeSchema` lives
 *  alongside this one when bkt lands; `PrUnavailableSourceSchema` already
 *  reserves the `provider` discriminator for the tagged-union extension. */
export const GhUnavailableCodeSchema = z.enum([
  "not-installed",
  "not-authenticated",
  "timed-out",
  "unknown",
]);
export type GhUnavailableCode = z.infer<typeof GhUnavailableCodeSchema>;

/** Display text for a gh unavailable code — single source of truth. Defined
 *  as a fresh `Record<GhUnavailableCode, string>` literal (not wrapped in
 *  `match`) so TypeScript's required/excess-property checks enforce both
 *  sides of exhaustiveness — adding a code without updating this table
 *  fails compilation, and removing one leaves a dead key that also fails. */
const GH_REASONS: Record<GhUnavailableCode, string> = {
  "not-installed": "gh: not installed",
  "not-authenticated": "gh: not authenticated",
  "timed-out": "gh: timed out",
  unknown: "gh: unknown error",
};

export function reasonForGhCode(code: GhUnavailableCode): string {
  return GH_REASONS[code];
}

// --- Provider-tagged unavailable source ---

export const GhUnavailableSchema = z.object({
  provider: z.literal("gh"),
  code: GhUnavailableCodeSchema,
});

/** Which provider classified the failure, plus that provider's typed code.
 *
 *  Today only `gh`; a sibling `BktUnavailableSchema` joins this union when
 *  bkt support lands (srid/agency#10). UI dispatch sites that render
 *  recovery instructions should `match(source.provider).exhaustive()` so
 *  adding a new provider arm forces every render site to handle it. */
export const PrUnavailableSourceSchema = z.discriminatedUnion("provider", [
  GhUnavailableSchema,
]);
export type PrUnavailableSource = z.infer<typeof PrUnavailableSourceSchema>;

/** Display string for any unavailable source — dispatches on provider to the
 *  provider's own reason lookup. `.exhaustive()` forces a compile error when
 *  bkt adds its arm to `PrUnavailableSourceSchema` until a matching `.with`
 *  lands here. */
export function reasonForSource(source: PrUnavailableSource): string {
  return match(source)
    .with({ provider: "gh" }, ({ code }) => reasonForGhCode(code))
    .exhaustive();
}

// --- PrResult ---

/** PR resolution state.
 *
 *  Decomplects distinct conditions that `GitHubPrInfo | null` used to
 *  collapse into one value:
 *    pending     — resolver is running (or stale after a branch change)
 *    ok          — resolver succeeded; a PR exists for this branch
 *    absent      — resolver succeeded; no PR for this branch (expected case)
 *    unavailable — resolver couldn't run; `source` carries the provider +
 *                  typed failure code, and the display reason is derived by
 *                  `reasonForSource`.
 *
 *  The UI needs to distinguish "absent" (nothing to show) from "unavailable"
 *  (show a warning with recovery instructions). Keeping the provenance in
 *  the same field as the value avoids a sibling-flag invariant.
 *
 *  Analogous schemas for git/agent/foreground are not introduced yet — their
 *  failure modes don't currently surface as user-actionable warnings. If they
 *  do, mirror this shape per-provider rather than inventing a cross-cutting
 *  status registry (see PR description for #148). */
export const PrResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ok"), value: GitHubPrInfoSchema }),
  z.object({ kind: z.literal("absent") }),
  z.object({
    kind: z.literal("unavailable"),
    source: PrUnavailableSourceSchema,
  }),
]);
export type PrResult = z.infer<typeof PrResultSchema>;

/** Extract the `GitHubPrInfo` when `kind === "ok"`, else `null`.
 *  Lets SolidJS `<Show when={prValue(meta.pr)}>` work without tripping on the
 *  object-truthy trap (every variant is a non-null object). */
export function prValue(pr: PrResult): GitHubPrInfo | null {
  return pr.kind === "ok" ? pr.value : null;
}

/** Extract the display reason when `kind === "unavailable"`, else `null`. */
export function prUnavailableReason(pr: PrResult): string | null {
  return pr.kind === "unavailable" ? reasonForSource(pr.source) : null;
}

/** Extract the tagged source when `kind === "unavailable"`, else `null`. Use
 *  this when the UI needs to dispatch on provider/code; `prUnavailableReason`
 *  is enough for a plain string tooltip. */
export function prUnavailableSource(pr: PrResult): PrUnavailableSource | null {
  return pr.kind === "unavailable" ? pr.source : null;
}
