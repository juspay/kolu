/**
 * Host chip status via {@link hostGlance} / {@link chipStatusDot}:
 * every host always paints connection status (local and remote).
 */

import type { EntryState } from "@kolu/surface-map";
import { testMembershipId } from "@kolu/surface-map/testing";
import {
  decodeHostKeyValue,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import {
  chipStatusDot,
  hostGlance,
  hostRowContext,
  type KavalChain,
  statusLabelShort,
} from "./hostChipTone";

const GREEN = "bg-emerald-400";

// These pins are about the ENTRY-state fold. The daemon-chain composition
// (#2101 N4) has its own file (`hostChainGlance.test.ts`), so every call here
// passes a whole chain — the composition is then provably a no-op over this
// table rather than silently absent from it.
const SERVING: KavalChain = { kind: "serving" };

// The multi-host feature is no longer gated on `KOLU_PADI_HOST` — the "+ add a
// host" affordance and every pool member's chip render unconditionally, so the
// old `hostGateOpen` / `shouldRenderHostChip` gate helpers and their tests are
// gone.

describe("hostGlance — exception strip + detail co-defined", () => {
  it("connected: strip silent, detail green, not down", () => {
    const g = hostGlance(
      {
        kind: "connected",
        membershipId: testMembershipId(),
        clockOffset: 0,
      },
      SERVING,
    );
    expect(g.stripDot).toBeNull();
    expect(g.detailDot).toBe(GREEN);
    expect(g.down).toBe(false);
    expect(g.short).toBe("connected");
    expect(g.title).toBe("connected");
    expect(g.labelDecoration).toBe("");
  });

  it("warming: amber pulse strip, not down", () => {
    const g = hostGlance(
      {
        kind: "warming",
        membershipId: testMembershipId(),
      },
      SERVING,
    );
    expect(g.stripDot).toContain("amber");
    expect(g.stripDot).toContain("animate-pulse");
    expect(g.stripDot).toContain("motion-reduce:animate-none");
    expect(g.down).toBe(false);
    expect(g.short).toBe("connecting");
    expect(g.title).toBe("connecting…");
  });

  it("failed: red strip + detail, down, struck, unreachable short, reason in title", () => {
    const g = hostGlance(
      {
        kind: "failed",
        membershipId: testMembershipId(),
        failure: { cause: "link-failed", reason: "ssh refused" },
        evidence: [],
      },
      SERVING,
    );
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
      const cls = hostGlance(s, SERVING).stripDot;
      if (cls !== null) {
        expect(cls).not.toBe(GREEN);
        expect(cls).not.toContain("emerald");
      }
    }
  });

  it("detailDot is green ONLY for connected", () => {
    expect(
      hostGlance(
        {
          kind: "connected",
          membershipId: testMembershipId(),
          clockOffset: 0,
        },
        SERVING,
      ).detailDot,
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
      expect(hostGlance(s, SERVING).detailDot).not.toBe(GREEN);
      expect(hostGlance(s, SERVING).detailDot).not.toContain("emerald");
    }
  });
});

describe("chipStatusDot — always-on for every host", () => {
  const local = decodeHostKeyValue({ kind: "local" });
  const remote = decodeHostKeyValue({ kind: "remote", target: "srid@zest" });
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
    expect(chipStatusDot(local, connected, SERVING)).toBe(GREEN);
  });

  it("remote healthy paints green", () => {
    expect(chipStatusDot(remote, connected, SERVING)).toBe(GREEN);
  });

  it("warming keeps the pulse class on local and remote", () => {
    for (const host of [local, remote]) {
      const cls = chipStatusDot(host, warming, SERVING);
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
    expect(statusLabelShort(failed, SERVING)).toBe("unreachable");
  });
});

describe("sameHost — the active-chip click guard's comparison (no churn on a no-op click)", () => {
  it("treats two INDEPENDENTLY-DECODED HostKeys with the same encoded string as the SAME host", () => {
    // Two fresh `decodeHostKeyValue` calls never return the same object reference —
    // this is exactly `props.host` (decoded anew from `entries.use().keys()` on every
    // membership read) vs. `activeHost()` (the persisted-pref signal's own decode) on
    // a real chip click: a no-op click on the already-active chip must read as "same
    // host" here, or the click guard in HostSelectorStrip.tsx can't do its job.
    const a = decodeHostKeyValue({ kind: "local" });
    const b = decodeHostKeyValue({ kind: "local" });
    expect(a).not.toBe(b); // genuinely different references
    expect(sameHost(a, b)).toBe(true);

    const remoteA = decodeHostKeyValue({
      kind: "remote",
      target: "srid@zest",
    });
    const remoteB = decodeHostKeyValue({
      kind: "remote",
      target: "srid@zest",
    });
    expect(remoteA).not.toBe(remoteB);
    expect(sameHost(remoteA, remoteB)).toBe(true);
  });

  it("treats two DIFFERENT hosts as different, regardless of reference", () => {
    const local = decodeHostKeyValue({ kind: "local" });
    const remote = decodeHostKeyValue({ kind: "remote", target: "srid@zest" });
    expect(sameHost(local, remote)).toBe(false);
  });
});
