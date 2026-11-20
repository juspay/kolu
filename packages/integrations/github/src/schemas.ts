/** Effect Schema for the gh-specific PR-unavailable source — browser-safe.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and ts-pattern only, no `anyforge` import either
 *  (the gh arm is self-contained; the generic kernel doesn't name it). */

import { Schema } from "effect";

/** Typed gh-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler. */
export const GhUnavailableCodeSchema = Schema.Literals([
  "not-installed",
  "not-authenticated",
  "timed-out",
  "unknown",
]);
export type GhUnavailableCode = typeof GhUnavailableCodeSchema.Type;

/** Display text for a gh unavailable code — single source of truth. Must
 *  stay a `Record<GhUnavailableCode, string>` literal so adding a code
 *  without updating this table fails compilation. */
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
 *  `PrUnavailableSource` union — the single source of this spelling.
 *
 *  Distinct from the adapter's in-process `ForgeAdapter.kind` ("github", see
 *  `resolve.ts`): that key drives dispatch/registry lookup, this tag is a
 *  persisted discriminant matched on the client (`surface.ts`), so the two
 *  values can't be merged without a wire-format change. */
export const GH_PROVIDER = "gh";

/** The gh arm of the app's closed `PrUnavailableSource` union: provider tag
 *  `"gh"` plus this adapter's typed code. */
export const GhUnavailableSchema = Schema.Struct({
  provider: Schema.Literal(GH_PROVIDER),
  code: GhUnavailableCodeSchema,
});
export type GhUnavailableSource = typeof GhUnavailableSchema.Type;
