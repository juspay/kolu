/**
 * HostSelectorStrip — the connection-dot tone is a FACT-ONLY green: the green class is
 * emitted for `connected` and NOTHING else. This is the same discipline `<HostStatusPip>`
 * enforces for a surface's `health()`; a map entry's equivalent fact is its `EntryStatus`
 * (which `connectSurfaceMap` floors on real transport liveness), so a chip can never show
 * green over a host that is warming, failed, or gone.
 */

import type { EntryState } from "@kolu/surface-map";
import { HostKeySchema } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { dotClass, sameHost, statusTitle } from "./hostChipTone";

const GREEN = "bg-emerald-400";

// The multi-host feature is no longer gated on `KOLU_PADI_HOST` — the "+ add a
// host" affordance and every pool member's chip render unconditionally (the
// alpha warning lives on the "+" popover instead), so the old `hostGateOpen` /
// `shouldRenderHostChip` gate helpers and their tests are gone.

describe("HostSelectorStrip dot tone — fact-only green", () => {
  it("emits green ONLY for connected", () => {
    expect(
      dotClass({ kind: "connected", membershipId: "", clockOffset: 0 }),
    ).toBe(GREEN);
  });

  it("never emits green for a not-connected state", () => {
    const notConnected: EntryState[] = [
      { kind: "warming", membershipId: "" },
      {
        kind: "failed",
        membershipId: "",
        failure: { cause: "link-failed", reason: "no drv" },
      },
      { kind: "not-a-member" },
    ];
    for (const s of notConnected) {
      expect(dotClass(s)).not.toBe(GREEN);
      expect(dotClass(s)).not.toContain("emerald");
    }
  });

  it("gives each state a distinct, honest tone", () => {
    expect(dotClass({ kind: "warming", membershipId: "" })).toContain("amber");
    expect(
      dotClass({
        kind: "failed",
        membershipId: "",
        failure: { cause: "link-failed", reason: "x" },
      }),
    ).toContain("red");
  });
});

describe("HostSelectorStrip status title", () => {
  it("surfaces the failure reason so a dead host is legible on hover", () => {
    expect(
      statusTitle({
        kind: "failed",
        membershipId: "",
        failure: { reason: "ssh refused" },
      }),
    ).toBe("failed: ssh refused");
    expect(
      statusTitle({ kind: "connected", membershipId: "", clockOffset: 3 }),
    ).toBe("connected");
    expect(statusTitle({ kind: "warming", membershipId: "" })).toBe(
      "connecting…",
    );
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
