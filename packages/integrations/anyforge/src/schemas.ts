/** Zod schemas + pure helpers for forge-neutral PR metadata — and the GENERIC
 *  result/provider shapes that name no forge.
 *
 *  The wire vocabulary every forge adapter speaks: `PrInfo` (the resolved PR)
 *  and `PrResult` (the resolution state machine), generic over the failure
 *  `source` so this leaf enumerates no forge. A concrete adapter (kolu-github)
 *  owns its own `*UnavailableSchema` in its own `./schemas` subpath; the app
 *  (kolu-common) composes the CLOSED, exhaustively-matchable
 *  `PrUnavailableSource` union and pins `PrResult` to it.
 *
 *  This is the same generic-shape-in-leaf / closed-union-in-app split anyagent
 *  makes: `AgentInfoShape { kind: string; … }` lives in the anyagent leaf
 *  (naming no agent), each agent owns its `*InfoSchema`, and `AgentInfoSchema`
 *  — the discriminated union — composes in kolu-common's surface. Here
 *  `PrUnavailableSourceBase { provider: string; code: string }` is the generic
 *  base, the gh arm lives in kolu-github, and the closed union composes in the
 *  app. A new forge's arm joins that app-side union; this leaf never changes.
 *
 *  Browser-safe: zod + ts-pattern only, no node APIs. Adapters implement
 *  `ForgeAdapter<S>` against these shapes and never import each other. */

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

/** Fold per-check outcomes into one combined status — the rule every forge
 *  shares: `fail` is terminal (one red gate fails the rollup), `pending` is
 *  sticky until something fails, `pass` only when every check passed. Returns
 *  `null` for an empty list (no checks configured). Each adapter maps its
 *  forge's raw check vocabulary to `CheckStatus` and hands the list here, so
 *  this combine logic lives once in the leaf rather than once per adapter. */
export function foldCheckOutcomes(outcomes: CheckStatus[]): PrInfo["checks"] {
  if (outcomes.length === 0) return null;
  let worst: CheckStatus = "pass";
  for (const outcome of outcomes) {
    if (outcome === "fail") return "fail";
    if (outcome === "pending") worst = "pending";
  }
  return worst;
}

// --- Generic unavailable source + PrResult ---

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
 *  union (the `PrResultSchema`-inferred type in kolu-common). The wire/zod
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
  // `a.kind === b.kind` from here on, so each arm safely narrows `b` to `a`'s
  // variant. Matched exhaustively (not a `kind`-cascade with a bare
  // `return true` tail) so a future payload-bearing PrResult variant is a
  // compile error here — without it, a new variant would fall through to
  // always-equal and the dedup gate would swallow every update to it
  // invisibly.
  return (
    match(a)
      .with({ kind: "ok" }, (a) => {
        const bv = (b as Extract<PrResult<S>, { kind: "ok" }>).value;
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
        const bs = (b as Extract<PrResult<S>, { kind: "unavailable" }>).source;
        return a.source.provider === bs.provider && a.source.code === bs.code;
      })
      // "pending", "absent", and "unsupported" have no payload — kind equality
      // (already checked) is enough.
      .with({ kind: P.union("pending", "absent", "unsupported") }, () => true)
      .exhaustive()
  );
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
