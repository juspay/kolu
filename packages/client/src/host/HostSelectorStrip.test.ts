/**
 * HostSelectorStrip — exception-based connection dots: healthy (`connected`) is
 * silent; amber for warming; red for failed. Green "fine" dots are deleted.
 */

import type { EntryState } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import { HostKeySchema } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import {
  dotClass,
  exceptionDotClass,
  isHostDown,
  sameHost,
  statusLabelShort,
  statusTitle,
} from "./hostChipTone";

const GREEN = "bg-emerald-400";

// The multi-host feature is no longer gated on `KOLU_PADI_HOST` — the "+ add a
// host" affordance and every pool member's chip render unconditionally, so the
// old `hostGateOpen` / `shouldRenderHostChip` gate helpers and their tests are
// gone.

describe("HostSelectorStrip exception dots — healthy is silent", () => {
  it("emits null for connected (no green fine-dot on the strip)", () => {
    expect(
      exceptionDotClass({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      }),
    ).toBeNull();
  });

  it("emits amber pulse for warming / connecting", () => {
    const cls = exceptionDotClass({
      kind: "warming",
      membershipId: testMembershipId(),
    });
    expect(cls).toContain("amber");
    expect(cls).toContain("animate-pulse");
    expect(cls).toContain("motion-reduce:animate-none");
  });

  it("emits red for failed / unreachable", () => {
    expect(
      exceptionDotClass({
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "x" },
      }),
    ).toContain("red");
  });

  it("never emits green on the exception strip path", () => {
    const states: EntryState[] = [
      {
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      },
      { kind: "warming", membershipId: testMembershipId() },
      {
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "no drv" },
      },
      { kind: "not-a-member" },
    ];
    for (const s of states) {
      const cls = exceptionDotClass(s);
      if (cls !== null) {
        expect(cls).not.toBe(GREEN);
        expect(cls).not.toContain("emerald");
      }
    }
  });
});

describe("dotClass — always-on tone for popover header (green only when connected)", () => {
  it("emits green ONLY for connected", () => {
    expect(
      dotClass({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      }),
    ).toBe(GREEN);
  });

  it("never emits green for a not-connected state", () => {
    const notConnected: EntryState[] = [
      { kind: "warming", membershipId: testMembershipId() },
      {
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "no drv" },
      },
      { kind: "not-a-member" },
    ];
    for (const s of notConnected) {
      expect(dotClass(s)).not.toBe(GREEN);
      expect(dotClass(s)).not.toContain("emerald");
    }
  });
});

describe("isHostDown + status labels", () => {
  it("marks only failed as down", () => {
    expect(
      isHostDown({
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "x" },
      }),
    ).toBe(true);
    expect(
      isHostDown({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      }),
    ).toBe(false);
    expect(
      isHostDown({ kind: "warming", membershipId: testMembershipId() }),
    ).toBe(false);
  });

  it("labels failed as unreachable (user language, not internal 'failed')", () => {
    expect(
      statusLabelShort({
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "x" },
      }),
    ).toBe("unreachable");
    expect(
      statusLabelShort({ kind: "warming", membershipId: testMembershipId() }),
    ).toBe("connecting");
  });
});

describe("HostSelectorStrip status title", () => {
  it("surfaces the failure reason so a dead host is legible on hover", () => {
    expect(
      statusTitle({
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { reason: "ssh refused" },
      }),
    ).toBe("failed: ssh refused");
    expect(
      statusTitle({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 3,
      }),
    ).toBe("connected");
    expect(
      statusTitle({ kind: "warming", membershipId: testMembershipId() }),
    ).toBe("connecting…");
  });
});

describe("sameHost — the active-chip click guard's comparison (no churn on a no-op click)", () => {
  it("treats two INDEPENDENTLY-DECODED HostKeys with the same encoded string as the SAME host", () => {
    // Two fresh `HostKeySchema.parse` calls never return the same object reference —
    // this is exactly `props.host` (decoded anew from `entries.use().keys()` on every
    // membership read) vs. `activeHost()` (the persisted-pref signal's own decode) on
    // a real chip click: a no-op click on the already-active chip must read as "same
    // host" here, or the click guard in HostSelectorStrip.tsx can't do its job.
    const a = HostKeySchema.parse({ kind: "local" });
    const b = HostKeySchema.parse({ kind: "local" });
    expect(a).not.toBe(b); // genuinely different references
    expect(sameHost(a, b)).toBe(true);

    const remoteA = HostKeySchema.parse({
      kind: "remote",
      target: "srid@zest",
    });
    const remoteB = HostKeySchema.parse({
      kind: "remote",
      target: "srid@zest",
    });
    expect(remoteA).not.toBe(remoteB);
    expect(sameHost(remoteA, remoteB)).toBe(true);
  });

  it("treats two DIFFERENT hosts as different, regardless of reference", () => {
    const local = HostKeySchema.parse({ kind: "local" });
    const remote = HostKeySchema.parse({ kind: "remote", target: "srid@zest" });
    expect(sameHost(local, remote)).toBe(false);
  });
});
