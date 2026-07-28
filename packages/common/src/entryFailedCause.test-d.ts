/**
 * TYPE-LEVEL pin — PR4's failure-is-domain-data shape.
 *
 * `tsc` GREEN over this file ⇒:
 *  - a BARE `EntryStatus` (the unnarrowed `Failure = unknown` default) carries an
 *    OPAQUE `failure` on its `failed` arm — a generic consumer keeps compiling with
 *    no knowledge of a domain's failure shape.
 *  - `padiHostMap`'s own `EntryStatus` is narrowed to {@link PadiEntryFailure} — the
 *    `failed` arm's `failure` must be a schema-valid domain value, so an arbitrary
 *    `cause` is a COMPILE ERROR (the `@ts-expect-error` below), not merely a runtime
 *    check.
 *  - {@link PadiEntryStatus}'s `contract-skew-refused` failure arm carries the typed
 *    `running`/`expected` version pair; every OTHER cause does not (unrepresentable
 *    to invent a version pair for e.g. `"link-failed"`).
 *  - `membershipId` is a BRANDED `MembershipId` (PR3), NOT a bare `string`: an empty
 *    `""` or a client-fabricated literal is a COMPILE ERROR (the `@ts-expect-error`
 *    below), so an opaque never-reused identity cannot be spelled by a consumer — it
 *    is minted only by `serveSurfaceMap` or the wire schema parse. Fixtures mint one
 *    through the sanctioned `testMembershipId()` helper, never a literal.
 */

import type { EntryStatus } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import type { PadiEntryFailure, PadiEntryStatus } from "./surfacesWithPadi.ts";

// A BARE `EntryStatus` (default `Failure = unknown`): the `failed` arm carries an
// opaque `failure`, so an unnarrowed consumer compiles with no domain knowledge.
const bare: EntryStatus = {
  kind: "failed",
  membershipId: testMembershipId(),
  failure: { anything: "at-all" },
  // `evidence` is REQUIRED on the failed arm — a fixed structural type surface-map
  // owns (never a generic), so even the unnarrowed consumer must state it.
  evidence: [],
};
void bare;

// `padiHostMap`'s narrowed status: the `failed` arm's `failure` must be a valid
// `PadiEntryFailure` (a schema-valid domain value), narrowed on `cause`.
const padiFailed: EntryStatus<PadiEntryFailure> = {
  kind: "failed",
  membershipId: testMembershipId(),
  failure: {
    cause: "contract-skew-refused",
    reason: "remote padi contract skew",
  },
  evidence: [{ source: "remote", line: "padi: refusing — version skew" }],
};
void padiFailed;

const padiFailedInvalid: EntryStatus<PadiEntryFailure> = {
  kind: "failed",
  membershipId: testMembershipId(),
  evidence: [],
  failure: {
    // @ts-expect-error — an arbitrary string is not a member of the failure's
    // `cause` discriminant; if this line ever compiles, the narrowing
    // (`padiHostMap`'s own `Failure`) has regressed to the generic default.
    cause: "some-made-up-reason",
    reason: "boom",
  },
};
void padiFailedInvalid;

// D2: the typed version pair rides ONLY the `contract-skew-refused` failure arm.
const skewed: PadiEntryStatus = {
  kind: "failed",
  membershipId: testMembershipId(),
  evidence: [],
  failure: {
    cause: "contract-skew-refused",
    reason: "padi contract skew",
    running: "1.0.0",
    expected: "1.1.0",
  },
};
void skewed;

const linkFailed: PadiEntryStatus = {
  kind: "failed",
  membershipId: testMembershipId(),
  evidence: [],
  failure: {
    cause: "link-failed",
    reason: "host unreachable",
    // @ts-expect-error — `running`/`expected` are NOT representable on any cause
    // other than `contract-skew-refused` (a version pair only means something for a
    // skew refusal) — if this compiles, the per-cause narrowing has regressed to a
    // flat, always-optional shape.
    running: "1.0.0",
  },
};
void linkFailed;

// PR3: `membershipId` is a BRANDED `MembershipId`, so a bare string — the empty
// `""` fixtures used to spell, or any client-fabricated literal — is a COMPILE
// ERROR. If this line ever compiles, the brand has regressed to a raw `string` and
// an opaque never-reused identity is spellable again (the P4 gap srid caught).
const fabricatedMembership: EntryStatus = {
  kind: "warming",
  // @ts-expect-error — a bare `string` is not assignable to the branded
  // `MembershipId`; only `serveSurfaceMap`'s mint / the wire parse / the
  // `testMembershipId()` helper can produce one.
  membershipId: "",
};
void fabricatedMembership;
