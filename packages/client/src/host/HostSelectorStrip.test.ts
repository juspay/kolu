/**
 * Host chip status via {@link hostGlance} / {@link chipStatusDot}:
 * every host always paints connection status (local and remote).
 */

import type { EntryState } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import { HostKeySchema } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import {
  chipStatusDot,
  hostGlance,
  hostRowContext,
  sameHost,
  statusLabelShort,
} from "./hostChipTone";

const GREEN = "bg-emerald-400";

// The multi-host feature is no longer gated on `KOLU_PADI_HOST` — the "+ add a
// host" affordance and every pool member's chip render unconditionally, so the
// old `hostGateOpen` / `shouldRenderHostChip` gate helpers and their tests are
// gone.

describe("hostGlance — exception strip + detail co-defined", () => {
  it("connected: strip silent, detail green, not down", () => {
    const g = hostGlance({
      kind: "connected",
      membershipId: testMembershipId(),
      clockOffset: 0,
    });
    expect(g.stripDot).toBeNull();
    expect(g.detailDot).toBe(GREEN);
    expect(g.down).toBe(false);
    expect(g.short).toBe("connected");
    expect(g.title).toBe("connected");
    expect(g.labelDecoration).toBe("");
  });

  it("warming: amber pulse strip, not down", () => {
    const g = hostGlance({
      kind: "warming",
      membershipId: testMembershipId(),
    });
    expect(g.stripDot).toContain("amber");
    expect(g.stripDot).toContain("animate-pulse");
    expect(g.stripDot).toContain("motion-reduce:animate-none");
    expect(g.down).toBe(false);
    expect(g.short).toBe("connecting");
    expect(g.title).toBe("connecting…");
  });

  it("failed: red strip + detail, down, struck, unreachable short, reason in title", () => {
    const g = hostGlance({
      kind: "failed",
      membershipId: testMembershipId(),
      failure: { cause: "link-failed", reason: "ssh refused" },
      evidence: [],
    });
    expect(g.stripDot).toContain("red");
    expect(g.detailDot).toContain("red");
    expect(g.down).toBe(true);
    expect(g.short).toBe("unreachable");
    expect(g.title).toBe("failed: ssh refused");
    expect(g.labelDecoration).toContain("line-through");
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
        evidence: [],
      },
      { kind: "not-a-member" },
    ];
    for (const s of states) {
      const cls = hostGlance(s).stripDot;
      if (cls !== null) {
        expect(cls).not.toBe(GREEN);
        expect(cls).not.toContain("emerald");
      }
    }
  });

  it("detailDot is green ONLY for connected", () => {
    expect(
      hostGlance({
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      }).detailDot,
    ).toBe(GREEN);
    const notConnected: EntryState[] = [
      { kind: "warming", membershipId: testMembershipId() },
      {
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "no drv" },
        evidence: [],
      },
      { kind: "not-a-member" },
    ];
    for (const s of notConnected) {
      expect(hostGlance(s).detailDot).not.toBe(GREEN);
      expect(hostGlance(s).detailDot).not.toContain("emerald");
    }
  });
});

describe("chipStatusDot — always-on for every host", () => {
  const local = HostKeySchema.parse({ kind: "local" });
  const remote = HostKeySchema.parse({ kind: "remote", target: "srid@zest" });
  const connected = {
    kind: "connected" as const,
    membershipId: testMembershipId(),
    clockOffset: 0,
  };
  const warming = {
    kind: "warming" as const,
    membershipId: testMembershipId(),
  };

  it("local healthy paints green (same as remote)", () => {
    expect(chipStatusDot(local, connected)).toBe(GREEN);
  });

  it("remote healthy paints green", () => {
    expect(chipStatusDot(remote, connected)).toBe(GREEN);
  });

  it("warming keeps the pulse class on local and remote", () => {
    for (const host of [local, remote]) {
      const cls = chipStatusDot(host, warming);
      expect(cls).toContain("amber");
      expect(cls).toContain("animate-pulse");
    }
  });
});

describe("hostRowContext — palette host status vocabulary", () => {
  const connected = {
    kind: "connected" as const,
    membershipId: testMembershipId(),
    clockOffset: 0,
  };
  const warming = {
    kind: "warming" as const,
    membershipId: testMembershipId(),
  };
  const failed = {
    kind: "failed" as const,
    membershipId: testMembershipId(),
    failure: { cause: "link-failed" as const, reason: "down" },
    evidence: [],
  };

  it("marks only the canvas-active host as active", () => {
    expect(hostRowContext(connected, true)).toBe("active");
    expect(hostRowContext(warming, true)).toBe("active");
  });

  it("is quiet for a healthy non-active host (connected is the default)", () => {
    expect(hostRowContext(connected, false)).toBe("");
  });

  it("surfaces exception states only", () => {
    expect(hostRowContext(warming, false)).toBe("connecting");
    expect(hostRowContext(failed, false)).toBe("unreachable");
    expect(statusLabelShort(failed)).toBe("unreachable");
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
