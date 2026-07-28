/**
 * The convergence policy TABLE, tested against the pure `decide` at ZERO I/O.
 * Budget gating is NOT a decide row — it lives in enactment (converge /
 * convergeAdmit); these tests cover the pure axes only.
 */

import { type ConvergenceIdentity, daemonBuild } from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import { decide } from "./decide.ts";
import type { AnyConvergencePolicy } from "./policy.ts";

const KAVAL: AnyConvergencePolicy = {
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
};
const PADI: AnyConvergencePolicy = {
  onContractSkew: { kind: "drain-newer-else-refuse" },
  onBuildMismatch: { kind: "drain-and-replace" },
};

const id = (contractVersion: string, buildId: string): ConvergenceIdentity => ({
  contractVersion,
  build: daemonBuild(buildId),
});

describe("decide — no survivor", () => {
  it("running null → spawn (both policies)", () => {
    expect(decide(id("1.1", "B"), null, KAVAL).kind).toBe("spawn");
    expect(decide(id("1.1", "B"), null, PADI).kind).toBe("spawn");
  });
});

describe("decide — contract axis (a skew decides; build id irrelevant)", () => {
  it("kaval recycles on ANY skew (newer OR older), build id ignored", () => {
    expect(decide(id("2.0", "B"), id("1.0", "A"), KAVAL).kind).toBe("recycle");
    expect(decide(id("1.0", "B"), id("2.0", "A"), KAVAL).kind).toBe("recycle");
  });

  it("padi DRAINS when strictly newer, REFUSES when older/behind (the ordering)", () => {
    const newer = decide(id("2.0", "B"), id("1.0", "A"), PADI);
    expect(newer).toMatchObject({
      kind: "drain-and-replace",
      axis: "contract",
    });
    const older = decide(id("1.0", "B"), id("2.0", "A"), PADI);
    expect(older.kind).toBe("refuse");
  });
});

describe("decide — build axis (contract compatible → would adopt)", () => {
  it("same build → adopt (both policies)", () => {
    expect(decide(id("1.1", "B"), id("1.1", "B"), KAVAL).kind).toBe("adopt");
    expect(decide(id("1.1", "B"), id("1.1", "B"), PADI).kind).toBe("adopt");
  });

  it("off-nix supervisor (baked buildId '') → adopt, never judges builds (both policies)", () => {
    expect(decide(id("1.1", ""), id("1.1", "B"), KAVAL).kind).toBe("adopt");
    expect(decide(id("1.1", ""), id("1.1", "B"), PADI).kind).toBe("adopt");
  });

  it("kaval build mismatch → report-mismatch (nudge-human, no supervisor action)", () => {
    const out = decide(id("1.1", "B"), id("1.1", "A"), KAVAL);
    expect(out).toMatchObject({
      kind: "report-mismatch",
      running: id("1.1", "A"),
    });
  });

  it("kaval ABSENT running build id → report-mismatch (absent == mismatch, a table row)", () => {
    const out = decide(id("1.1", "B"), id("1.1", ""), KAVAL);
    expect(out).toMatchObject({ kind: "report-mismatch" });
  });

  it("padi build mismatch → drain-and-replace (budget gates at enactment, not here)", () => {
    const out = decide(id("1.1", "B"), id("1.1", "A"), PADI);
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });

  it("padi ABSENT running build id → drain-and-replace (absent == mismatch)", () => {
    const out = decide(id("1.1", "B"), id("1.1", ""), PADI);
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });
});
