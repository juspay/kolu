import { Effect, Schema } from "effect";
import { match, P } from "ts-pattern";

export const CheckStatusSchema = Schema.Literals(["pending", "pass", "fail"]);
export type CheckStatus = typeof CheckStatusSchema.Type;

export const PrStateSchema = Schema.Literals(["open", "closed", "merged"]);
export type PrState = typeof PrStateSchema.Type;

/** GitHub's `PullRequestReviewDecision`, carried verbatim — a consumer
 *  predicates on gh's own values (`APPROVED` / `CHANGES_REQUESTED` /
 *  `REVIEW_REQUIRED`) rather than a friendlier vocabulary. `null` is gh's
 *  own "no decision" (no reviews yet, or reviews not required). */
export const ReviewDecisionSchema = Schema.Literals([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
]);
export type ReviewDecision = typeof ReviewDecisionSchema.Type;

/** GitHub's `MergeStateStatus`, carried verbatim — a consumer predicates
 *  on gh's own values rather than a friendlier vocabulary. The members
 *  are the GraphQL enum as `gh pr view --json mergeStateStatus` returns
 *  them. */
export const MergeStateStatusSchema = Schema.Literals([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
]);
export type MergeStateStatus = typeof MergeStateStatusSchema.Type;

/** Per-check entry of the PR's CI rollup. The dock pip's tooltip lists
 *  these so a reviewer sees which specific gate is red without opening
 *  the PR. `name` is the check's name as the forge reports it (e.g.
 *  `ci::biome@x86_64-linux`). */
export const CheckRunSchema = Schema.Struct({
  name: Schema.String,
  outcome: CheckStatusSchema,
});
export type CheckRun = typeof CheckRunSchema.Type;

function optionalOnWireAlwaysEncoded<S extends Schema.Constraint>(
  schema: S,
  whenMissing: S["Encoded"],
): Schema.withDecodingDefaultKey<S> {
  return Schema.withDecodingDefaultKey<S>(Effect.succeed(whenMissing))(schema);
}

export const PrInfoSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  /** PR state: open, closed, or merged. */
  state: PrStateSchema,
  /** Combined CI status: pending, pass, or fail. Null if no checks configured. */
  checks: Schema.NullOr(CheckStatusSchema),
  /** Per-check breakdown — the same data `checks` rolls up. Empty when no
   *  checks are configured, and when the sender predates the field. */
  checkRuns: optionalOnWireAlwaysEncoded(Schema.Array(CheckRunSchema), []),
  /** Review decision as gh reports it — `null` is gh's own "no decision",
   *  and also what a sender predating the field reads as. */
  reviewDecision: optionalOnWireAlwaysEncoded(
    Schema.NullOr(ReviewDecisionSchema),
    null,
  ),
  /** Merge state as gh reports it — or `null`, "this reading carries no
   *  merge state": a payload from a sender older than the field. Kept apart
   *  from gh's own `UNKNOWN` ("not worked out yet"), which is an answer a
   *  consumer waits out, while `null` is a sender that will never say. */
  mergeStateStatus: optionalOnWireAlwaysEncoded(
    Schema.NullOr(MergeStateStatusSchema),
    null,
  ),
  /** THE COMMIT THE REST OF THIS VALUE IS ABOUT — the PR's head oid, as the
   *  forge spells it. The one field that makes a check reading comparable
   *  with another: `checks` alone says "pending" for two different pushes,
   *  and a consumer that keeps a history of check states cannot otherwise
   *  tell a re-read of the old commit from the new one's first run
   *  (juspay/kolu#2376 — two terminals in one worktree wrote 430 events
   *  ping-ponging between their two readings of ONE pull request).
   *
   *  It belongs in the VALUE rather than beside it as a fetch time because
   *  it only moves on a push: `prResultEqual` compares it, so it rides the
   *  existing dedup instead of republishing every terminal's PR metadata on
   *  every poll, which is what a stamp of when the answer was read would do.
   *
   *  `null` is "this reading carries no head" — a payload from a daemon
   *  older than this field, which is the same rolling-deploy tolerance
   *  `checkRuns` and `reviewDecision` spell above. Never a guess. */
  headSha: optionalOnWireAlwaysEncoded(Schema.NullOr(Schema.String), null),
  /** Whether the PR is a DRAFT, as the forge says it. Required, with no
   *  decoding default: a draft is a fact a consumer acts on (a draft cannot
   *  merge, whatever `mergeStateStatus` says — GitHub retired its `DRAFT`
   *  merge state in favour of this field and now works the merge state out
   *  as if the PR were ready), so a reading that does not say is refused,
   *  never guessed. */
  isDraft: Schema.Boolean,
});
export type PrInfo = typeof PrInfoSchema.Type;

/** Fold per-check outcomes into one combined status — the rule every forge
 *  shares: `fail` is terminal (one red gate fails the rollup), `pending` is
 *  sticky until something fails, `pass` only when every check passed. Returns
 *  `null` for an empty list (no checks configured). Each adapter maps its
 *  forge's raw check vocabulary to `CheckStatus` and hands the list here, so
 *  this combine logic lives once in the leaf rather than once per adapter. */
export function foldCheckOutcomes(
  outcomes: readonly CheckStatus[],
): PrInfo["checks"] {
  if (outcomes.length === 0) return null;
  let worst: CheckStatus = "pass";
  for (const outcome of outcomes) {
    if (outcome === "fail") return "fail";
    if (outcome === "pending") worst = "pending";
  }
  return worst;
}

/** The generic failure source the kernel knows: a provider tag + its code.
 *  The CLOSED, exhaustively-matchable union over concrete adapters is composed
 *  in the app (kolu-common), exactly as AgentInfoSchema composes the per-agent
 *  schemas — the leaf names no forge. */
export type PrUnavailableSourceBase = { provider: string; code: string };

/** PR resolution state, generic over the failure `source`.
 *
 *  Decomplects distinct conditions that `PrInfo | null` used to
 *  collapse into one value:
 *    pending     — resolver is running (or stale after a branch change)
 *    ok          — resolver succeeded; a PR exists for this branch
 *    absent      — resolver succeeded; no PR for this branch (expected case)
 *    unsupported — kolu has no PR adapter for this repo's remote (a non-GitHub
 *                  forge, an unrecognized host, or no remote at all), so no
 *                  resolver ran. A distinct state, NOT `absent`: "no adapter for
 *                  this remote" and "this branch has no PR" are different facts,
 *                  and folding one onto the other would make them
 *                  indistinguishable (and let a non-GitHub remote be misread as a
 *                  `gh` failure). Renders nothing, like `absent` — but honestly,
 *                  by a dispatch decision at the knowing endpoint rather than a
 *                  guessed classification of a tool's stderr.
 *    unavailable — resolver couldn't run; `source` carries the provider +
 *                  typed failure code, and the display reason is derived in
 *                  the app (kolu-common's `reasonForSource`).
 *
 *  The UI needs to distinguish "absent" (nothing to show) from "unavailable"
 *  (show a warning with recovery instructions). Keeping the provenance in
 *  the same field as the value avoids a sibling-flag invariant.
 *
 *  Generic over `S extends PrUnavailableSourceBase` so this leaf names no
 *  forge: a concrete adapter instantiates it at its own tagged source
 *  (`PrResult<GhUnavailableSource>`), and the app pins it to the CLOSED
 *  union (the `PrResultSchema`-inferred type in kolu-common). The wire
 *  schema lives in the app for the same reason `AgentInfoSchema` does.
 *
 *  Analogous schemas for git/agent/foreground are not introduced yet — their
 *  failure modes don't currently surface as user-actionable warnings. If they
 *  do, mirror this shape per-provider rather than inventing a cross-cutting
 *  status registry (see PR description for juspay/kolu#148). */
export type PrResult<
  S extends PrUnavailableSourceBase = PrUnavailableSourceBase,
> =
  | { kind: "pending" }
  | { kind: "ok"; value: PrInfo }
  | { kind: "absent" }
  | { kind: "unsupported" }
  | { kind: "unavailable"; source: S };

/** Extract the `PrInfo` when `kind === "ok"`, else `null`.
 *  Lets SolidJS `<Show when={prValue(meta.pr)}>` work without tripping on the
 *  object-truthy trap (every variant is a non-null object). */
export function prValue<S extends PrUnavailableSourceBase>(
  pr: PrResult<S>,
): PrInfo | null {
  return pr.kind === "ok" ? pr.value : null;
}

/** Single source of truth for the `#123 Title` PR label used in
 *  notification text, tooltips, and any other plain-string surface. */
export function prLabel(pr: PrInfo): string {
  return `#${pr.number} ${pr.title}`;
}

/** Compare two PR resolution states for equality — the dedup gate
 *  `subscribePr` runs before every emit. Generic over the source: the body
 *  only compares `source.provider`/`source.code` (strings), so one
 *  implementation serves every concrete adapter and the closed app union. */
export function prResultEqual<S extends PrUnavailableSourceBase>(
  a: PrResult<S>,
  b: PrResult<S>,
): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  return match(a)
    .with({ kind: "ok" }, (a) => {
      const bv = (b as Extract<PrResult<S>, { kind: "ok" }>).value;
      return (
        a.value.number === bv.number &&
        a.value.title === bv.title &&
        a.value.url === bv.url &&
        a.value.state === bv.state &&
        a.value.checks === bv.checks &&
        checkRunsEqual(a.value.checkRuns, bv.checkRuns) &&
        a.value.reviewDecision === bv.reviewDecision &&
        a.value.mergeStateStatus === bv.mergeStateStatus &&
        a.value.headSha === bv.headSha &&
        a.value.isDraft === bv.isDraft
      );
    })
    .with({ kind: "unavailable" }, (a) => {
      const bs = (b as Extract<PrResult<S>, { kind: "unavailable" }>).source;
      return a.source.provider === bs.provider && a.source.code === bs.code;
    })
    .with({ kind: P.union("pending", "absent", "unsupported") }, () => true)
    .exhaustive();
}

function checkRunsEqual(
  a: readonly CheckRun[],
  b: readonly CheckRun[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (ai, i) => ai.name === b[i]?.name && ai.outcome === b[i]?.outcome,
  );
}
