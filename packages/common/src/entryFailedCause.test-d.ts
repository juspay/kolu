import type { EntryStatus } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import type { PadiEntryFailure, PadiEntryStatus } from "./surfacesWithPadi.ts";

const bare: EntryStatus = {
  kind: "failed",
  membershipId: testMembershipId(),
  failure: { anything: "at-all" },
  evidence: [],
};
void bare;

const padiFailed: EntryStatus<PadiEntryFailure> = {
  kind: "failed",
  membershipId: testMembershipId(),
  failure: {
    cause: "contract-skew-refused",
    reason: "remote padi contract skew",
    running: "9.0",
    expected: "9.1",
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
    cause: "some-made-up-reason",
    reason: "boom",
  },
};
void padiFailedInvalid;

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
    cause: "host-setup-failed",
    reason: "nix build failed",
    // @ts-expect-error — `running`/`expected` are NOT representable on any cause
    running: "1.0.0",
  },
};
void linkFailed;

const fabricatedMembership: EntryStatus = {
  kind: "warming",
  // @ts-expect-error — a bare `string` is not assignable to the branded
  membershipId: "",
};
void fabricatedMembership;
