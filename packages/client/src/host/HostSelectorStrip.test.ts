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
import {
  dotClass,
  hostGateOpen,
  sameHost,
  shouldRenderHostChip,
  statusTitle,
} from "./hostChipTone";

const GREEN = "bg-emerald-400";

describe("HostSelectorStrip gate — closed ⇒ no MULTIPLE-host chrome (W4 header redesign)", () => {
  // `hostGateOpen` no longer decides whether the strip exists at all (it always
  // carries the active host's chip + its Padi/Kaval sub-chips) — it decides whether
  // chips BEYOND the active one, and the "+ add" affordance, appear.
  it("stays closed until the server opens the gate — no dual path, no flash-in", () => {
    expect(hostGateOpen(undefined)).toBe(false); // pre-first-frame ⇒ closed (no flash)
    expect(hostGateOpen({ enabled: false })).toBe(false); // env-unset single-host default
    expect(hostGateOpen({ enabled: true })).toBe(true); // KOLU_PADI_HOST seeded a remote
  });
});

describe("shouldRenderHostChip — per-chip visibility (the ONE gate consumer that decides a chip's fate)", () => {
  it("always renders the active chip, gate open or closed", () => {
    expect(shouldRenderHostChip(false, true)).toBe(true);
    expect(shouldRenderHostChip(true, true)).toBe(true);
  });

  it("renders an inactive chip ONLY when the gate is open", () => {
    expect(shouldRenderHostChip(false, false)).toBe(false);
    expect(shouldRenderHostChip(true, false)).toBe(true);
  });
});

describe("HostSelectorStrip dot tone — fact-only green", () => {
  it("emits green ONLY for connected", () => {
    expect(dotClass({ kind: "connected", clockOffset: 0 })).toBe(GREEN);
  });

  it("never emits green for a not-connected state", () => {
    const notConnected: EntryState[] = [
      { kind: "warming" },
      { kind: "failed", reason: "no drv for arch" },
      { kind: "not-a-member" },
    ];
    for (const s of notConnected) {
      expect(dotClass(s)).not.toBe(GREEN);
      expect(dotClass(s)).not.toContain("emerald");
    }
  });

  it("gives each state a distinct, honest tone", () => {
    expect(dotClass({ kind: "warming" })).toContain("amber");
    expect(dotClass({ kind: "failed", reason: "x" })).toContain("red");
  });
});

describe("HostSelectorStrip status title", () => {
  it("surfaces the failure reason so a dead host is legible on hover", () => {
    expect(statusTitle({ kind: "failed", reason: "ssh refused" })).toBe(
      "failed: ssh refused",
    );
    expect(statusTitle({ kind: "connected", clockOffset: 3 })).toBe(
      "connected",
    );
    expect(statusTitle({ kind: "warming" })).toBe("connecting…");
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
