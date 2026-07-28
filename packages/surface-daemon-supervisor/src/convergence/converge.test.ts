/**
 * `converge` / `convergeAdmit` orchestration — decision → budget → enactment,
 * typed outcomes + anomalies, and the two-supervisor drain-war termination.
 *
 * Wave-2 pins: F1 post-drain foreign respawn, F5 spawned-fresh ≠ stale, F3
 * drain-not-taken on link-down, F10 arm-before-fire ordering.
 */

import {
  type ConvergenceIdentity,
  daemonBuild,
  type Logger,
} from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import type { BindResult } from "./bindResult.ts";
import { createConnectorDrainBudget, createDrainBudget } from "./budget.ts";
import { convergeAdmit } from "./convergeAdmit.ts";
import { converge, outcomeAdopted, outcomeAnomaly } from "./converge.ts";
import { drainAndAwaitExit } from "./drainAndAwaitExit.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConnectorPolicy, ConvergencePolicy } from "./policy.ts";
import type { Endpoint } from "../endpoint.ts";
import { registerTestEndpointBinds } from "../endpoint.private.ts";

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const id = (contractVersion: string, buildId: string): ConvergenceIdentity => ({
  contractVersion,
  build: daemonBuild(buildId),
});

const KAVAL: ConvergencePolicy<"not-drainable"> = {
  capability: "not-drainable",
  baked: id("2.0", "B"),
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
};

function padiPolicy(
  baked: ConvergenceIdentity = id("1.1", "B"),
  maxAttempts = 2,
): ConvergencePolicy<"drainable"> {
  return {
    capability: "drainable",
    baked,
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    drainBudget: { maxAttempts, onGiveUp: "adopt-stale" },
  };
}

function connectorPolicy(
  baked: ConvergenceIdentity = id("1.1", "B"),
  maxAttempts = 2,
): ConnectorPolicy {
  return {
    capability: "drainable",
    baked,
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    drainBudget: { maxAttempts, onGiveUp: "adopt-stale" },
  };
}

function ik(n: number): InstanceKey {
  return instanceKeyFromStartedAt(n);
}

function fakeEndpoint<Cap extends "drainable" | "not-drainable">(opts: {
  bindResult?: BindResult;
  /** Dynamic bind result (e.g. post-drain foreign). */
  bindFn?: () => Promise<BindResult>;
  policy: ConvergencePolicy<Cap>;
  probe: Endpoint<unknown, unknown, undefined, Cap>["probe"];
}) {
  const calls: string[] = [];
  const budget =
    opts.policy.capability === "drainable"
      ? createDrainBudget(opts.policy as ConvergencePolicy<"drainable">)
      : null;
  const defaultResult: BindResult = opts.bindResult ?? {
    kind: "adopted-resident",
  };
  const endpoint = {
    policy: opts.policy,
    probe: opts.probe,
    budget: budget as Endpoint<unknown, unknown, undefined, Cap>["budget"],
    log: silent,
    current: () => undefined,
    holdRestarting: async (body: () => Promise<void>) => body(),
  } as Endpoint<unknown, unknown, undefined, Cap>;
  const doBind = async (name: string): Promise<BindResult> => {
    calls.push(name);
    if (opts.bindFn) return opts.bindFn();
    return defaultResult;
  };
  registerTestEndpointBinds(endpoint, {
    adoptOrSpawnOrRefuse: () => doBind("adoptOrSpawnOrRefuse"),
    adoptOrEnsure: () => doBind("adoptOrEnsure"),
    ensure: async () => {
      calls.push("ensure");
    },
  });
  return { endpoint, calls, budget };
}

function drainableProbe(
  identity: ConvergenceIdentity,
  hooks: {
    onDrain?: () => void;
    hang?: boolean;
    instanceKey?: InstanceKey;
    ceilingMs?: number;
  } = {},
) {
  const p = {
    capability: "drainable" as const,
    identity,
    instanceKey: hooks.instanceKey ?? ik(0),
    disposed: false,
    drained: false,
    drainCeilingMs: hooks.ceilingMs ?? 50,
    fireDrain: async () => {
      p.drained = true;
      hooks.onDrain?.();
    },
    awaitExit: async (signal: AbortSignal) => {
      if (hooks.hang) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
    },
    dispose: () => {
      p.disposed = true;
    },
  };
  return p;
}

function plainProbe(identity: ConvergenceIdentity) {
  return {
    capability: "not-drainable" as const,
    identity,
    instanceKey: ik(0),
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

describe("converge — enactment + outcomes", () => {
  it("no survivor → bind refused → not-adopted", async () => {
    const { endpoint, calls } = fakeEndpoint({
      bindResult: { kind: "refused-or-failed" },
      policy: padiPolicy(),
      probe: async () => null,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("not-adopted");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });

  it("kaval contract skew → adoptOrEnsure; outcome recycled", async () => {
    const probe = plainProbe(id("1.0", "A"));
    const { endpoint, calls } = fakeEndpoint({
      bindResult: { kind: "refused-or-failed" },
      policy: KAVAL,
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("recycled");
    expect(outcomeAdopted(out)).toBe(false);
    expect(calls).toEqual(["adoptOrEnsure"]);
    expect(probe.disposed).toBe(true);
  });

  it("padi OLDER contract → refuse + skew-refused anomaly", async () => {
    const probe = drainableProbe(id("2.0", "A"));
    const { endpoint } = fakeEndpoint({
      bindResult: { kind: "refused-or-failed" },
      policy: padiPolicy(id("1.0", "B")),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
  });

  it("padi build mismatch drain takes + spawned-fresh → drained-replacing (F5 not stale)", async () => {
    const probe = drainableProbe(id("1.1", "A"), { instanceKey: ik(1) });
    const { endpoint } = fakeEndpoint({
      bindResult: { kind: "spawned-fresh" },
      policy: padiPolicy(),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(probe.drained).toBe(true);
    expect(out.kind).toBe("drained-replacing");
    expect(outcomeAnomaly(out)).toBeNull();
    expect(outcomeAdopted(out)).toBe(false);
  });

  it("F5: budget give-up + spawned-fresh is clean, not adopted-stale", async () => {
    const probe = drainableProbe(id("1.1", "A"), {
      hang: true,
      instanceKey: ik(1),
      ceilingMs: 20,
    });
    const { endpoint } = fakeEndpoint({
      bindResult: { kind: "spawned-fresh" },
      policy: padiPolicy(id("1.1", "B"), 1),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    // Not-taken then bind spawns fresh → not stale
    expect(out.kind).toBe("spawned-fresh");
    expect(outcomeAnomaly(out)).toBeNull();
  });

  it("F1: foreign respawn between drain and bind → cross-supervisor", async () => {
    let probeN = 0;
    const { endpoint } = fakeEndpoint({
      bindResult: { kind: "adopted-resident" },
      policy: padiPolicy(id("1.1", "mine"), 3),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          // Initial wrong build instance 1 — will drain.
          return drainableProbe(id("1.1", "A"), { instanceKey: ik(1) });
        }
        // Post-bind re-probe: foreign instance 2 of same drained build.
        return drainableProbe(id("1.1", "A"), { instanceKey: ik(2) });
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("cross-supervisor");
    if (a?.kind === "cross-supervisor") {
      expect(a.drained).toEqual(ik(1));
      expect(a.observed).toEqual(ik(2));
    }
  });
});

describe("convergeAdmit — connector arm", () => {
  it("matched build → adopt", async () => {
    const policy = connectorPolicy(id("1.1", "B"));
    const budget = createConnectorDrainBudget(policy);
    const out = await convergeAdmit({
      running: { ...id("1.1", "B"), instanceKey: ik(1) },
      budget,
      drain: async () => {
        throw new Error("should not drain");
      },
      awaitExit: async () => {},
      ceilingMs: 50,
      log: silent,
    });
    expect(out).toEqual({ kind: "adopt" });
  });

  it("build mismatch drain takes → replaced", async () => {
    const policy = connectorPolicy(id("1.1", "B"));
    const budget = createConnectorDrainBudget(policy);
    let drained = false;
    const out = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: ik(1) },
      budget,
      drain: async () => {
        drained = true;
      },
      awaitExit: async () => {}, // process oracle says exited
      ceilingMs: 50,
      log: silent,
    });
    expect(drained).toBe(true);
    expect(out.kind).toBe("replaced");
  });

  it("F3: awaitExit only aborts (link-down, no process oracle) → not replaced", async () => {
    const policy = connectorPolicy(id("1.1", "B"), 1);
    const budget = createConnectorDrainBudget(policy);
    let drained = false;
    const out = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: ik(1) },
      budget,
      drain: async () => {
        drained = true;
      },
      // Never resolves until abort — models link-down without process death.
      awaitExit: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      ceilingMs: 30,
      log: silent,
    });
    expect(drained).toBe(true);
    expect(out.kind).not.toBe("replaced");
    if (out.kind === "adopt-stale" || out.kind === "refuse") {
      const a = out.anomaly;
      if (a.kind === "unconverged") {
        expect(a.cause.kind).toBe("drain-not-taken");
      }
    }
  });

  it("two-supervisor drain war ends in cross-supervisor with BOTH keys", async () => {
    const policy = connectorPolicy(id("1.1", "mine"), 3);
    const budget = createConnectorDrainBudget(policy);
    const first = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: ik(1) },
      budget,
      drain: async () => {},
      awaitExit: async () => {},
      ceilingMs: 50,
      log: silent,
    });
    expect(first.kind).toBe("replaced");
    const second = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: ik(2) },
      budget,
      drain: async () => {
        throw new Error("should not drain");
      },
      awaitExit: async () => {},
      ceilingMs: 50,
      log: silent,
    });
    expect(second.kind).toBe("refuse");
    if (
      second.kind === "refuse" &&
      second.anomaly.kind === "cross-supervisor"
    ) {
      expect(second.anomaly.drained).toEqual(ik(1));
      expect(second.anomaly.observed).toEqual(ik(2));
    }
  });
});

describe("F10: drainAndAwaitExit arms awaitExit before fireDrain", () => {
  it("awaitExit is invoked strictly before the drain verb fires", async () => {
    const order: string[] = [];
    await drainAndAwaitExit(
      async () => {
        order.push("drain");
      },
      async (signal) => {
        order.push("awaitExit-armed");
        // Exit immediately after arm.
        void signal;
        order.push("awaitExit-resolved");
      },
      { ceilingMs: 100 },
    );
    expect(order[0]).toBe("awaitExit-armed");
    expect(order.indexOf("drain")).toBeGreaterThan(
      order.indexOf("awaitExit-armed"),
    );
  });
});
