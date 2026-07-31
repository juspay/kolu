/**
 * The convergence policy TABLE, tested against the pure `decide` at ZERO I/O.
 * Budget gating is NOT a decide row — it lives in enactment (converge /
 * convergeAdmit); these tests cover the pure axes only.
 *
 * F8: `decide(policy, running)` reads `policy.baked` — no free-standing baked arg.
 */

import { type ConvergenceIdentity, daemonBuild } from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import { decide } from "./decide.ts";
import type { AnyConvergencePolicy } from "./policy.ts";

const id = (contractVersion: string, buildId: string): ConvergenceIdentity => ({
  contractVersion,
  build: daemonBuild(buildId),
});

function kaval(
  baked: ConvergenceIdentity = id("2.0", "B"),
): AnyConvergencePolicy {
  return {
    capability: "not-drainable",
    baked,
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  };
}

function padi(
  baked: ConvergenceIdentity = id("1.1", "B"),
): AnyConvergencePolicy {
  return {
    capability: "drainable",
    baked,
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    drainBudget: { maxAttempts: 2, onGiveUp: "adopt-stale" },
  };
}

describe("decide — no survivor", () => {
  it("running null → spawn (both policies)", () => {
    expect(decide(kaval(), null).kind).toBe("spawn");
    expect(decide(padi(), null).kind).toBe("spawn");
  });
});

describe("decide — contract axis (a skew decides; build id irrelevant)", () => {
  it("kaval recycles on ANY skew (newer OR older), build id ignored", () => {
    expect(decide(kaval(id("2.0", "B")), id("1.0", "A")).kind).toBe("recycle");
    expect(decide(kaval(id("1.0", "B")), id("2.0", "A")).kind).toBe("recycle");
  });

  it("padi DRAINS when strictly newer, REFUSES when older/behind (the ordering)", () => {
    const newer = decide(padi(id("2.0", "B")), id("1.0", "A"));
    expect(newer).toMatchObject({
      kind: "drain-and-replace",
      axis: "contract",
    });
    const older = decide(padi(id("1.0", "B")), id("2.0", "A"));
    expect(older.kind).toBe("refuse");
  });
});

describe("decide — build axis (contract compatible → would adopt)", () => {
  it("same build → adopt (both policies)", () => {
    expect(decide(kaval(id("1.1", "B")), id("1.1", "B")).kind).toBe("adopt");
    expect(decide(padi(id("1.1", "B")), id("1.1", "B")).kind).toBe("adopt");
  });

  it("off-nix supervisor (baked buildId '') → adopt, never judges builds (both policies)", () => {
    expect(decide(kaval(id("1.1", "")), id("1.1", "B")).kind).toBe("adopt");
    expect(decide(padi(id("1.1", "")), id("1.1", "B")).kind).toBe("adopt");
  });

  it("kaval build mismatch → report-mismatch (nudge-human, no supervisor action)", () => {
    const out = decide(kaval(id("1.1", "B")), id("1.1", "A"));
    expect(out).toMatchObject({
      kind: "report-mismatch",
      running: id("1.1", "A"),
    });
  });

  it("kaval ABSENT running build id → report-mismatch (absent == mismatch, a table row)", () => {
    const out = decide(kaval(id("1.1", "B")), id("1.1", ""));
    expect(out).toMatchObject({ kind: "report-mismatch" });
  });

  it("padi build mismatch → drain-and-replace (budget gates at enactment, not here)", () => {
    const out = decide(padi(id("1.1", "B")), id("1.1", "A"));
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });

  it("padi ABSENT running build id → drain-and-replace (absent == mismatch)", () => {
    const out = decide(padi(id("1.1", "B")), id("1.1", ""));
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });
});
