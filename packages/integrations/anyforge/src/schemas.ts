/** Zod schemas + pure helpers for forge-neutral PR metadata.
 *
 *  The wire vocabulary every forge adapter speaks: `PrInfo` (the resolved
 *  PR), `PrResult` (the resolution state machine), and the **closed**
 *  `PrUnavailableSource` union of per-forge failure codes. Per-forge codes
 *  are part of this neutral contract — not adapter internals — because the
 *  client renders recovery instructions per code and must
 *  `match(...).exhaustive()`: a new forge arm is a compile error at every
 *  render site, the same trade-off `AgentInfoSchema` makes (kolu-common's
 *  surface).
 *
 *  Browser-safe: zod + ts-pattern only, no node APIs. Adapters (kolu-github
 *  today, kolu-forgejo in kolu#1240 phase 1) implement `PrProvider` against
 *  these shapes and never import each other. */

import { match, P } from "ts-pattern";
import { z } from "zod";

// --- PR info ---

export const CheckStatusSchema = z.enum(["pending", "pass", "fail"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const PrStateSchema = z.enum(["open", "closed", "merged"]);
export type PrState = z.infer<typeof PrStateSchema>;

/** Per-check entry of the PR's CI rollup. The dock pip's tooltip lists
 *  these so a reviewer sees which specific gate is red without opening
 *  the PR. `name` is the check's name as the forge reports it (e.g.
 *  `ci::biome@x86_64-linux`). */
export const CheckRunSchema = z.object({
  name: z.string(),
  outcome: CheckStatusSchema,
});
export type CheckRun = z.infer<typeof CheckRunSchema>;

export const PrInfoSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  /** PR state: open, closed, or merged. */
  state: PrStateSchema,
  /** Combined CI status: pending, pass, or fail. Null if no checks configured. */
  checks: CheckStatusSchema.nullable(),
  /** Per-check breakdown — same data `checks` rolls up. Empty when no
   *  checks are configured. `.default([])` so an older server emitting
   *  payloads without this field still parses on a newer client. */
  checkRuns: z.array(CheckRunSchema).default([]),
});
export type PrInfo = z.infer<typeof PrInfoSchema>;

// --- gh-specific unavailable code ---

/** Typed gh-failure code for the `unavailable` PrResult variant.
 *
 *  A discriminator separate from any human-readable display text so UI
 *  callers that want to dispatch per-failure can `match(code).exhaustive()`
 *  and get a compile error when a new code is added without a handler —
 *  rather than string-comparing display text and silently breaking on typo.
 *
 *  Named with the `Gh` prefix so a parallel `ForgejoUnavailableCodeSchema`
 *  lives alongside this one when the Forgejo adapter lands (kolu#1240
 *  phase 1); `PrUnavailableSourceSchema` already reserves the `provider`
 *  discriminator for the tagged-union extension. */
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
 *  Today only `gh`; a sibling `ForgejoUnavailableSchema` joins this union
 *  when the Forgejo adapter lands (kolu#1240 phase 1). UI dispatch sites
 *  that render recovery instructions should `match(source.provider)
 *  .exhaustive()` so adding a new provider arm forces every render site to
 *  handle it. */
export const PrUnavailableSourceSchema = z.discriminatedUnion("provider", [
  GhUnavailableSchema,
]);
export type PrUnavailableSource = z.infer<typeof PrUnavailableSourceSchema>;

/** Display string for any unavailable source — dispatches on provider to the
 *  provider's own reason lookup. `.exhaustive()` forces a compile error when
 *  a new forge adds its arm to `PrUnavailableSourceSchema` until a matching
 *  `.with` lands here. */
export function reasonForSource(source: PrUnavailableSource): string {
  return match(source)
    .with({ provider: "gh" }, ({ code }) => reasonForGhCode(code))
    .exhaustive();
}

// --- PrResult ---

/** PR resolution state.
 *
 *  Decomplects distinct conditions that `PrInfo | null` used to
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
 *  status registry (see PR description for juspay/kolu#148). */
export const PrResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pending") }),
  z.object({ kind: z.literal("ok"), value: PrInfoSchema }),
  z.object({ kind: z.literal("absent") }),
  z.object({
    kind: z.literal("unavailable"),
    source: PrUnavailableSourceSchema,
  }),
]);
export type PrResult = z.infer<typeof PrResultSchema>;

/** Extract the `PrInfo` when `kind === "ok"`, else `null`.
 *  Lets SolidJS `<Show when={prValue(meta.pr)}>` work without tripping on the
 *  object-truthy trap (every variant is a non-null object). */
export function prValue(pr: PrResult): PrInfo | null {
  return pr.kind === "ok" ? pr.value : null;
}

/** Single source of truth for the `#123 Title` PR label used in
 *  notification text, tooltips, and any other plain-string surface. */
export function prLabel(pr: PrInfo): string {
  return `#${pr.number} ${pr.title}`;
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

/** Compare two PR resolution states for equality — the dedup gate
 *  `subscribePr` runs before every emit. */
export function prResultEqual(a: PrResult, b: PrResult): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  // `a.kind === b.kind` from here on, so each arm safely narrows `b` to `a`'s
  // variant. Matched exhaustively (not a `kind`-cascade with a bare
  // `return true` tail) so a future payload-bearing PrResult variant is a
  // compile error here — without it, a new variant would fall through to
  // always-equal and the dedup gate would swallow every update to it
  // invisibly.
  return match(a)
    .with({ kind: "ok" }, (a) => {
      const bv = (b as Extract<PrResult, { kind: "ok" }>).value;
      return (
        a.value.number === bv.number &&
        a.value.title === bv.title &&
        a.value.url === bv.url &&
        a.value.state === bv.state &&
        a.value.checks === bv.checks &&
        checkRunsEqual(a.value.checkRuns, bv.checkRuns)
      );
    })
    .with({ kind: "unavailable" }, (a) => {
      // Compare the tagged source: provider + code. Both are the typed
      // discriminators; the display reason derives from them via
      // `reasonForSource` and doesn't need its own comparison.
      const bs = (b as Extract<PrResult, { kind: "unavailable" }>).source;
      return a.source.provider === bs.provider && a.source.code === bs.code;
    })
    // "pending" and "absent" have no payload — kind equality (already checked)
    // is enough.
    .with({ kind: P.union("pending", "absent") }, () => true)
    .exhaustive();
}

/** Shallow per-element equality for the per-check breakdown. Same length
 *  + same `(name, outcome)` in the same order. Same order is fine
 *  because adapters preserve the order the forge returns — re-fetches
 *  with no real change produce the same sequence, so a `===`-style
 *  identity check survives ordinary polling without false positives. */
function checkRunsEqual(a: CheckRun[], b: CheckRun[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (ai, i) => ai.name === b[i]?.name && ai.outcome === b[i]?.outcome,
  );
}
