/**
 * TYPE-LEVEL pin (PR3) — a {@link MembershipId} is NOMINAL: a bare `string` is not
 * one, so an empty `""` or a client-fabricated id is a COMPILE error, not a runtime
 * convention.
 *
 * The brand moved from zod's `.brand("MembershipId")` to Effect Schema's
 * `Schema.brand("MembershipId")`, and this file is the proof the guarantee moved with
 * it: the whole point of the brand is that it cannot be forged, and a brand that
 * silently degraded to `string` would leave every "the illegal value is
 * unrepresentable" claim in `define.ts` unbacked while every runtime test kept
 * passing. `tsc` GREEN over this file ⇒ the nominality holds; deleting the brand would
 * make the `@ts-expect-error` lines compile and fail the pin.
 *
 * The RUNTIME half — the `isMinLength(1)` check that refuses `""` at the decode
 * boundary — is pinned in `failureEvidence.test.ts`.
 */

import type { EntryStatus, MembershipId } from "./define";
import { decodeMembershipId, PENDING_MEMBERSHIP_ID } from "./define";
import { testMembershipId } from "./testing";

// The two sanctioned producers hand back a real `MembershipId`.
const minted: MembershipId = decodeMembershipId(crypto.randomUUID());
void minted;
const fixture: MembershipId = testMembershipId("m1");
void fixture;
const pending: MembershipId = PENDING_MEMBERSHIP_ID;
void pending;

// @ts-expect-error — a bare string literal is NOT a MembershipId (the brand is the
// whole point: a fabricated id must be unspellable, not merely discouraged).
const fabricated: MembershipId = "m1";
void fabricated;

// @ts-expect-error — the empty id, the specific value PR3 exists to make unspellable.
const empty: MembershipId = "";
void empty;

declare const someString: string;
// @ts-expect-error — nor does an arbitrary runtime string widen into one.
const widened: MembershipId = someString;
void widened;

// The other direction is FINE: a `MembershipId` IS a string, so it keys maps and
// concatenates without a cast (the brand is erased at runtime).
const asString: string = fixture;
void asString;

// And the brand rides every published arm, so a status literal cannot be assembled
// with a fabricated id either.
const status: EntryStatus = { kind: "warming", membershipId: fixture };
void status;
// @ts-expect-error — same brand, one level in: the arm's own field refuses a bare string.
const forgedStatus: EntryStatus = { kind: "warming", membershipId: "nope" };
void forgedStatus;
