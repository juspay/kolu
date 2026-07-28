/**
 * `@kolu/surface-map/evidence` — the failure-evidence VOCABULARY and its wire schema.
 *
 * A leaf on purpose. `define.ts` imports `@orpc/contract` and `@kolu/surface/define` as
 * VALUES to build the map's wire contract; this module imports `zod` and nothing else, so
 * a browser-bundle-constrained consumer (`@kolu/surface-remote/connection`, whose whole
 * point is that it pulls no node/server code) can hold the SCHEMA — not just the type —
 * without dragging the contract builder into its graph. `define.ts` re-exports both
 * names, so nothing else has to know this file exists.
 */

import { z } from "zod";

/** One retained output line of a failed entry's episode — the WHOLE structural
 *  vocabulary {@link FailureEvidence} is built from. `source` says WHERE the line
 *  came from (`"local"` = the serving process's own chatter, `"remote"` = the far
 *  end's forwarded output); it is a FIELD, never an in-band `[local] ` prefix.
 *
 *  Deliberately a FIXED structural type owned by this package, NOT a third generic
 *  parameter beside `Failure`/`Conn`. Evidence is not domain volatility: every
 *  transport that can fail can produce provenance-tagged output lines, and
 *  `@kolu/surface-remote`'s own `SessionState.log` (`readonly LogEntry[]`) is
 *  structurally exactly this — so the producer passes its retained tail straight
 *  through (reuse of the existing source of truth; there is no second evidence
 *  pipe to keep in sync, and nothing to inject). `LogEntry` IS this type, and
 *  `LogEntrySchema` IS {@link EvidenceLineSchema} — one definition each, so "the two
 *  vocabularies drifted" has no spelling rather than a pin that watches for it. */
export interface EvidenceLine {
  readonly source: "local" | "remote";
  readonly line: string;
}

/** The wire validator for {@link EvidenceLine}. EXPORTED so the one other place a
 *  provenance-tagged line needs a concrete browser-safe validator —
 *  `@kolu/surface-remote/connection`'s `ConnectionInfoSchema.log` — can BE this schema
 *  rather than restate it.
 *
 *  It was module-private, on the argument that exporting it "would invite a SECOND
 *  validation site". That argument was already false when it was written: `connection.ts`
 *  validated these same lines inside `ConnectionInfoSchema.log` and always had. The
 *  second site existed; what privacy bought was a second DEFINITION of it, guarded by a
 *  `ZodType<LogEntry>` annotation that does not guard — TypeScript accepts a NARROWER
 *  schema annotated as a wider type, so adding a third provenance to `EvidenceLine` would
 *  have compiled clean on both sides. One exported schema closes that direction by
 *  construction. */
export const EvidenceLineSchema: z.ZodType<EvidenceLine> = z.object({
  source: z.enum(["local", "remote"]),
  line: z.string(),
});

/** The retained output tail STAPLED to a failure record — the EVIDENCE for the
 *  reason, pinned at the classification seam from the same frame the reason was
 *  classified from. A post-mortem record, not a live view.
 *
 *  It rides the FAILURE, not the live `connection` payload, and that is the whole
 *  point: `floorOnLiveness` DROPS `connection` over a dead link (a frozen live word
 *  keeps narrating work that is no longer happening) while keeping `failure` — so
 *  before this existed, a consumer could hold a reason with its evidence already
 *  floored away, and kolu did exactly that for a year (juspay/kolu#2007). Carrying
 *  the tail on the failure record makes reason-without-evidence UNSPELLABLE: the
 *  type requires it on both down arms, `entryStatusSchema` requires it on the
 *  wire, and the floor keeps it by construction.
 *
 *  The move is only complete because the OLD home was also closed: the published
 *  `failed` arm carries no `connection` at all. Had it kept one, the same frame's tail
 *  would ride the entry twice and `connection?.log` would still be the spellable,
 *  compiling, floorable read the whole change exists to remove — the defect relocated
 *  rather than eliminated. One tail, one home, one arm that can hold it.
 *
 *  `[]` is a REAL value with ONE meaning — "the failure genuinely produced no
 *  output" — minted only by the seam that knows. It is never a fallback for
 *  "we couldn't see it": there is no such state on a failed arm any more. */
export type FailureEvidence = readonly EvidenceLine[];

/** The wire/zod schema for {@link FailureEvidence} — a module const (not a function of a
 *  domain schema like the failure value): evidence is a fixed structural type this
 *  package owns, so there is exactly one schema for it. */
export const FailureEvidenceSchema: z.ZodType<FailureEvidence> = z
  .array(EvidenceLineSchema)
  .readonly();
