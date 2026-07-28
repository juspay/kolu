/**
 * Drain budget memory — survives adopts; cross-supervisor on foreign instance
 * of a drained build; SAME-instance flap hits maxAttempts.
 */

import { daemonBuild } from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import { createDrainBudget } from "./budget.ts";

const buildA = daemonBuild("aaa");
const buildB = daemonBuild("bbb");

describe("createDrainBudget", () => {
  it("admits up to maxAttempts for the same lineage", () => {
    const budget = createDrainBudget({
      maxAttempts: 2,
      onGiveUp: "adopt-stale",
    });
    const lineage = { build: buildA, instanceKey: 1 };
    expect(budget.admit(lineage, "why").kind).toBe("drain");
    expect(budget.admit(lineage, "why").kind).toBe("drain");
    const third = budget.admit(lineage, "why");
    expect(third).toMatchObject({ kind: "giveUp", why: "budget" });
  });

  it("does NOT reset after a clean adopt of a different build (survives adopts)", () => {
    const budget = createDrainBudget({
      maxAttempts: 1,
      onGiveUp: "adopt-stale",
    });
    // Drain A once (budget spent for A@1).
    expect(
      budget.admit({ build: buildA, instanceKey: 1 }, "mismatch").kind,
    ).toBe("drain");
    // "Adopt" our own build B — we do NOT call anything on the budget (survives).
    // A foreign respawn of A under a new instance → cross-supervisor.
    const fight = budget.admit({ build: buildA, instanceKey: 2 }, "mismatch");
    expect(fight).toMatchObject({ kind: "giveUp", why: "cross-supervisor" });
  });

  it("a different build is a fresh lineage (not cross-supervisor)", () => {
    const budget = createDrainBudget({
      maxAttempts: 1,
      onGiveUp: "refuse",
    });
    expect(
      budget.admit({ build: buildA, instanceKey: 1 }, "mismatch").kind,
    ).toBe("drain");
    expect(
      budget.admit({ build: buildB, instanceKey: 1 }, "mismatch").kind,
    ).toBe("drain");
  });

  it("refuses non-positive maxAttempts at construction", () => {
    expect(() =>
      createDrainBudget({ maxAttempts: 0, onGiveUp: "refuse" }),
    ).toThrow(/positive integer/);
  });
});
