/**
 * Drain budget memory — survives adopts; cross-supervisor on foreign instance
 * of a drained build; SAME-instance flap hits maxAttempts; pre-instance is a
 * named lineage (never overloaded null).
 */

import { daemonBuild } from "@kolu/surface-daemon";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  budgetInternal,
  createDrainBudget,
  type DrainAdmission,
  type DrainBudgetHandle,
  type DrainLineage,
} from "./budget.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConvergencePolicy } from "./policy.ts";

/** `admit` is an Effect over the budget's `Ref`; the test is the process edge.
 *  `runSync` (not `runPromise`) because the transition must remain a single
 *  synchronous step — if it ever stops being one, this helper goes red. */
function admit(
  budget: DrainBudgetHandle,
  lineage: DrainLineage,
  axisHint: string,
): DrainAdmission {
  return Effect.runSync(budgetInternal(budget).admit(lineage, axisHint));
}

function drainable(
  maxAttempts: number,
  onGiveUp: "adopt-stale" | "refuse" = "adopt-stale",
): ConvergencePolicy<"drainable"> {
  return {
    capability: "drainable",
    baked: { contractVersion: "1.0", build: daemonBuild("mine") },
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    drainBudget: { maxAttempts, onGiveUp },
  };
}

const buildA = daemonBuild("aaa");
const buildB = daemonBuild("bbb");
const ik = (n: number): InstanceKey => instanceKeyFromStartedAt(n);
const pre: InstanceKey = instanceKeyFromStartedAt(undefined);

describe("createDrainBudget", () => {
  it("admits up to maxAttempts for the same lineage", () => {
    const budget = createDrainBudget(drainable(2));
    const lineage = { build: buildA, instanceKey: ik(1) };
    expect(admit(budget, lineage, "why").kind).toBe("drain");
    expect(admit(budget, lineage, "why").kind).toBe("drain");
    const third = admit(budget, lineage, "why");
    expect(third).toMatchObject({ kind: "giveUp", why: "budget" });
  });

  it("does NOT reset after a clean adopt of a different build (survives adopts)", () => {
    const budget = createDrainBudget(drainable(1));
    // Drain A once (budget spent for A@1).
    expect(
      admit(budget, { build: buildA, instanceKey: ik(1) }, "mismatch").kind,
    ).toBe("drain");
    // "Adopt" our own build B — we do NOT call anything on the budget (survives).
    // A foreign respawn of A under a new instance → cross-supervisor.
    const fight = admit(
      budget,
      { build: buildA, instanceKey: ik(2) },
      "mismatch",
    );
    expect(fight).toMatchObject({ kind: "giveUp", why: "cross-supervisor" });
    if (fight.kind === "giveUp" && fight.why === "cross-supervisor") {
      expect(fight.drained).toEqual(ik(1));
      expect(fight.observed).toEqual(ik(2));
    }
  });

  it("a different build is a fresh lineage (not cross-supervisor)", () => {
    const budget = createDrainBudget(drainable(1, "refuse"));
    expect(
      admit(budget, { build: buildA, instanceKey: ik(1) }, "mismatch").kind,
    ).toBe("drain");
    expect(
      admit(budget, { build: buildB, instanceKey: ik(1) }, "mismatch").kind,
    ).toBe("drain");
  });

  it("pre-instance is a named lineage (budgetable; not null)", () => {
    const budget = createDrainBudget(drainable(1));
    expect(pre).toEqual({ kind: "pre-instance" });
    expect(
      admit(budget, { build: buildA, instanceKey: pre }, "old-daemon").kind,
    ).toBe("drain");
    // Same pre-instance lineage hits maxAttempts.
    const second = admit(
      budget,
      { build: buildA, instanceKey: pre },
      "old-daemon",
    );
    expect(second).toMatchObject({ kind: "giveUp", why: "budget" });
  });

  it("pre-instance and a named instance under the same build are distinct lineages", () => {
    const budget = createDrainBudget(drainable(1));
    expect(admit(budget, { build: buildA, instanceKey: pre }, "old").kind).toBe(
      "drain",
    );
    // Named instance of same build after draining pre-instance → cross-supervisor
    // (different instance of a drained build).
    const fight = admit(
      budget,
      { build: buildA, instanceKey: ik(99) },
      "new-instance",
    );
    expect(fight).toMatchObject({ kind: "giveUp", why: "cross-supervisor" });
    if (fight.kind === "giveUp" && fight.why === "cross-supervisor") {
      expect(fight.drained).toEqual(pre);
      expect(fight.observed).toEqual(ik(99));
    }
  });

  it("refuses non-positive maxAttempts at construction", () => {
    expect(() => createDrainBudget(drainable(0, "refuse"))).toThrow(
      /positive integer/,
    );
  });
});
