/**
 * HostSelectorStrip — the connection-dot tone is a FACT-ONLY green: the green class is
 * emitted for `connected` and NOTHING else. This is the same discipline `<HostStatusPip>`
 * enforces for a surface's `health()`; a map entry's equivalent fact is its `EntryStatus`
 * (which `connectSurfaceMap` floors on real transport liveness), so a chip can never show
 * green over a host that is warming, failed, or gone.
 */

import type { EntryStatus } from "@kolu/surface-map";
import { describe, expect, it } from "vitest";
import { dotClass, statusTitle } from "./hostChipTone";

const GREEN = "bg-emerald-400";

describe("HostSelectorStrip dot tone — fact-only green", () => {
  it("emits green ONLY for connected", () => {
    expect(dotClass({ kind: "connected", clockOffset: 0 })).toBe(GREEN);
  });

  it("never emits green for a not-connected state", () => {
    const notConnected: (EntryStatus | { kind: "not-a-member" })[] = [
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
