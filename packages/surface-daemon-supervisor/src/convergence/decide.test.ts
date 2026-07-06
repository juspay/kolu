/**
 * The convergence policy TABLE, tested against the pure `decide` at ZERO I/O — the
 * fold-style core the whole kit rests on. Two declared policies (kaval: recycle-on-skew +
 * nudge-human; padi: drain-newer-else-refuse + drain-and-replace) crossed with every
 * axis state (no survivor · contract skew newer/older · build match/mismatch/absent ·
 * off-nix baked · fence spent). The absent / off-nix / fence cases are ROWS here, never
 * special-cased branches.
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
    expect(decide(id("1.1", "B"), null, KAVAL, false).kind).toBe("spawn");
    expect(decide(id("1.1", "B"), null, PADI, false).kind).toBe("spawn");
  });
});

describe("decide — contract axis (a skew decides; build id irrelevant)", () => {
  it("kaval recycles on ANY skew (newer OR older), build id ignored", () => {
    // me newer (2.0 vs 1.0) and me older (1.0 vs 2.0) both recycle for kaval.
    expect(decide(id("2.0", "B"), id("1.0", "A"), KAVAL, false).kind).toBe(
      "recycle",
    );
    expect(decide(id("1.0", "B"), id("2.0", "A"), KAVAL, false).kind).toBe(
      "recycle",
    );
  });

  it("padi DRAINS when strictly newer, REFUSES when older/behind (the ordering)", () => {
    const newer = decide(id("2.0", "B"), id("1.0", "A"), PADI, false);
    expect(newer).toMatchObject({
      kind: "drain-and-replace",
      axis: "contract",
    });
    const older = decide(id("1.0", "B"), id("2.0", "A"), PADI, false);
    expect(older.kind).toBe("refuse");
  });

  it("padi's contract drain is unaffected by the build fence (a different axis)", () => {
    const spent = decide(id("2.0", "B"), id("1.0", "A"), PADI, true);
    expect(spent).toMatchObject({
      kind: "drain-and-replace",
      axis: "contract",
    });
  });
});

describe("decide — build axis (contract compatible → would adopt)", () => {
  it("same build → adopt (both policies)", () => {
    expect(decide(id("1.1", "B"), id("1.1", "B"), KAVAL, false).kind).toBe(
      "adopt",
    );
    expect(decide(id("1.1", "B"), id("1.1", "B"), PADI, false).kind).toBe(
      "adopt",
    );
  });

  it("off-nix supervisor (baked buildId '') → adopt, never judges builds (both policies)", () => {
    expect(decide(id("1.1", ""), id("1.1", "B"), KAVAL, false).kind).toBe(
      "adopt",
    );
    expect(decide(id("1.1", ""), id("1.1", "B"), PADI, false).kind).toBe(
      "adopt",
    );
  });

  it("kaval build mismatch → report-mismatch (nudge-human, no supervisor action)", () => {
    const out = decide(id("1.1", "B"), id("1.1", "A"), KAVAL, false);
    expect(out).toMatchObject({
      kind: "report-mismatch",
      running: id("1.1", "A"),
    });
  });

  it("kaval ABSENT running build id → report-mismatch (absent == mismatch, a table row)", () => {
    const out = decide(id("1.1", "B"), id("1.1", ""), KAVAL, false);
    expect(out).toMatchObject({ kind: "report-mismatch" });
  });

  it("padi build mismatch, fence NOT spent → drain-and-replace (build axis)", () => {
    const out = decide(id("1.1", "B"), id("1.1", "A"), PADI, false);
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });

  it("padi ABSENT running build id, fence not spent → drain-and-replace (absent == mismatch)", () => {
    const out = decide(id("1.1", "B"), id("1.1", ""), PADI, false);
    expect(out).toMatchObject({ kind: "drain-and-replace", axis: "build" });
  });

  it("padi build mismatch, fence SPENT → adopt (once-per-boot: a reconnect never re-drains)", () => {
    expect(decide(id("1.1", "B"), id("1.1", "A"), PADI, true).kind).toBe(
      "adopt",
    );
  });
});
