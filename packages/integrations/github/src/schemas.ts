/** Zod schema for the gh-specific PR-unavailable source — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the gh arm without pulling the package root, which transitively evaluates
 *  `node:child_process` (the `gh pr view` spawn in `resolve.ts`). Mirrors the
 *  `claude-code/schemas` precedent. The forge-neutral, generic
 *  `PrUnavailableSourceBase` / `PrResult<S>` live in `anyforge/schemas`; this
 *  file owns the concrete gh arm that the app (kolu-common) composes into the
 *  CLOSED `PrUnavailableSource` union — exactly as `ClaudeCodeInfoSchema` is
 *  the per-agent arm composed into `AgentInfoSchema`.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — zod and ts-pattern only, no `anyforge` import either (the gh arm
 *  is self-contained; the generic kernel doesn't name it). */

import { z } from "zod";

/** Typed gh-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler —
 *  rather than string-comparing display text and silently breaking on typo. */
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

/** The wire/persisted provider tag for the gh arm of the closed
 *  `PrUnavailableSource` union. The single source of this spelling: both the
 *  schema literal below and the `classifyGhError` failure construction in
 *  `github.ts` reference it, so the tag a reader must recognize as "the same
 *  forge" lives in exactly one place rather than two hand-aligned literals.
 *
 *  Distinct from the adapter's in-process `PrProvider.kind` ("github", see
 *  `resolve.ts`): that key drives dispatch/registry lookup, this tag is a
 *  persisted discriminant matched on the client (`surface.ts`), so the two
 *  values can't be merged without a wire-format change. */
export const GH_PROVIDER = "gh";

/** The gh arm of the app's closed `PrUnavailableSource` union: provider tag
 *  `"gh"` plus this adapter's typed code. The discriminated union over all
 *  forge arms composes in the app (kolu-common), the same place
 *  `AgentInfoSchema` composes the per-agent schemas. */
export const GhUnavailableSchema = z.object({
  provider: z.literal(GH_PROVIDER),
  code: GhUnavailableCodeSchema,
});
export type GhUnavailableSource = z.infer<typeof GhUnavailableSchema>;
