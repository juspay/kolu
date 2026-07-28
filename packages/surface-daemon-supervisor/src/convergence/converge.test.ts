/**
 * `converge` / `convergeAdmit` orchestration — decision → budget → enactment,
 * typed outcomes + anomalies, and the two-supervisor drain-war termination.
 */

import {
  type ConvergenceIdentity,
  daemonBuild,
  type Logger,
} from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import { createDrainBudget } from "./budget.ts";
import { convergeAdmit } from "./convergeAdmit.ts";
import {
  type ConvergingEndpoint,
  converge,
  outcomeAdopted,
  outcomeAnomaly,
} from "./converge.ts";
import type { ConvergencePolicy } from "./policy.ts";

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

function fakeEndpoint<Cap extends "drainable" | "not-drainable">(opts: {
  adopted?: boolean;
  policy: ConvergencePolicy<Cap>;
  probe: ConvergingEndpoint<Cap>["probe"];
}) {
  const calls: string[] = [];
  const budget =
    opts.policy.capability === "drainable"
      ? createDrainBudget(opts.policy as ConvergencePolicy<"drainable">)
      : null;
  const endpoint: ConvergingEndpoint<Cap> = {
    adoptOrSpawnOrRefuse: async () => {
      calls.push("adoptOrSpawnOrRefuse");
      return opts.adopted ?? false;
    },
    adoptOrEnsure: async () => {
      calls.push("adoptOrEnsure");
      return opts.adopted ?? false;
    },
    policy: opts.policy,
    probe: opts.probe,
    budget: budget as ConvergingEndpoint<Cap>["budget"],
    log: silent,
  };
  return { endpoint, calls, budget };
}

function drainableProbe(
  identity: ConvergenceIdentity,
  hooks: {
    onDrain?: () => void;
    /** When true, awaitExit never resolves → drain not-taken. */
    hang?: boolean;
    instanceKey?: number | null;
    ceilingMs?: number;
  } = {},
) {
  const p = {
    capability: "drainable" as const,
    identity,
    instanceKey: hooks.instanceKey ?? null,
    disposed: false,
    drained: false,
    drainCeilingMs: hooks.ceilingMs ?? 50,
    fireDrain: async () => {
      p.drained = true;
      hooks.onDrain?.();
    },
    awaitExit: async (signal: AbortSignal) => {
      if (hooks.hang) {
        // Never exits; honour abort so the ceiling wins cleanly.
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      // Exit immediately (drain took).
    },
    dispose: () => {
      p.disposed = true;
    },
  };
  return p;
}

function plainProbe(identity: ConvergenceIdentity) {
  const p = {
    capability: "not-drainable" as const,
    identity,
    disposed: false,
    dispose: () => {
      p.disposed = true;
    },
  };
  return p;
}

describe("converge — enactment + outcomes", () => {
  it("no survivor → adoptOrSpawnOrRefuse binds; bind did not adopt → outcome not-adopted", async () => {
    const { endpoint, calls } = fakeEndpoint({
      adopted: false,
      policy: padiPolicy(),
      probe: async () => null,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("not-adopted");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });

  it("kaval contract skew → adoptOrEnsure (recycle); outcome recycled; probe disposed", async () => {
    const probe = plainProbe(id("1.0", "A"));
    const { endpoint, calls } = fakeEndpoint({
      adopted: false,
      policy: KAVAL,
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out).toMatchObject({ kind: "recycled", adopted: false });
    expect(outcomeAdopted(out)).toBe(false);
    expect(calls).toEqual(["adoptOrEnsure"]);
    expect(probe.disposed).toBe(true);
  });

  it("recycle where the endpoint ADOPTS → recycled(adopted=true)", async () => {
    const { endpoint } = fakeEndpoint({
      adopted: true,
      policy: KAVAL,
      probe: async () => plainProbe(id("1.0", "A")),
    });
    const out = await converge(endpoint);
    expect(out).toMatchObject({ kind: "recycled", adopted: true });
    expect(outcomeAdopted(out)).toBe(true);
  });

  it("padi OLDER contract → refuse + skew-refused anomaly", async () => {
    const probe = drainableProbe(id("2.0", "A"));
    const { endpoint, calls } = fakeEndpoint({
      adopted: false,
      policy: padiPolicy(id("1.0", "B")),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(probe.drained).toBe(false);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });

  it("kaval build mismatch → mismatch-reported via adoptOrEnsure", async () => {
    const probe = plainProbe(id("2.0", "A"));
    const { endpoint, calls } = fakeEndpoint({
      adopted: true,
      policy: { ...KAVAL, baked: id("2.0", "B") },
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out).toMatchObject({
      kind: "mismatch-reported",
      running: id("2.0", "A"),
    });
    expect(calls).toEqual(["adoptOrEnsure"]);
  });

  it("padi build mismatch → drains once then spawns; outcome drained-replacing(build)", async () => {
    const probe = drainableProbe(id("1.1", "A"), { instanceKey: 1 });
    const { endpoint, calls } = fakeEndpoint({
      adopted: false,
      policy: padiPolicy(),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(probe.drained).toBe(true);
    expect(out).toMatchObject({ kind: "drained-replacing", axis: "build" });
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
    expect(probe.disposed).toBe(true);
  });

  it("padi reconnect with the SAME budget never re-drains past maxAttempts → adopted-stale", async () => {
    let drains = 0;
    const policy = padiPolicy(id("1.1", "B"), 1);
    const { endpoint, budget } = fakeEndpoint({
      adopted: true,
      policy,
      probe: async () =>
        drainableProbe(id("1.1", "A"), {
          instanceKey: 1,
          onDrain: () => drains++,
        }),
    });
    // First converge: drains (maxAttempts: 1).
    await converge(endpoint);
    expect(drains).toBe(1);
    // Second: budget spent → adopt-stale, no further drain.
    const out2 = await converge(endpoint);
    expect(drains).toBe(1);
    expect(outcomeAnomaly(out2)?.kind).toBe("adopted-stale");
    expect(budget).not.toBeNull();
  });

  it("padi drain not-taken → adopted-stale anomaly (same path as convergeAdmit)", async () => {
    const probe = drainableProbe(id("1.1", "A"), {
      hang: true,
      instanceKey: 1,
      ceilingMs: 20,
    });
    const { endpoint, calls } = fakeEndpoint({
      adopted: true,
      policy: padiPolicy(id("1.1", "B"), 1),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    // Not-taken is give-up, not a silent drained-replacing.
    expect(out.kind).toBe("adopted");
    expect(outcomeAnomaly(out)?.kind).toBe("adopted-stale");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
    expect(probe.disposed).toBe(true);
  });
});

describe("convergeAdmit — connector arm + cross-supervisor termination", () => {
  it("matched build → adopt, no anomaly", async () => {
    const policy = padiPolicy(id("1.1", "B"));
    const budget = createDrainBudget(policy);
    const out = await convergeAdmit({
      running: { ...id("1.1", "B"), instanceKey: 1 },
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
    const policy = padiPolicy(id("1.1", "B"));
    const budget = createDrainBudget(policy);
    let drained = false;
    const out = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: 1 },
      budget,
      drain: async () => {
        drained = true;
      },
      awaitExit: async () => {}, // exits immediately
      ceilingMs: 50,
      log: silent,
    });
    expect(drained).toBe(true);
    expect(out.kind).toBe("replaced");
  });

  it("endpoint arm: cross-supervisor does NOT bind/adopt the contested build", async () => {
    // Drain A@1, then A@2 → cross-supervisor. Endpoint must not call the ordinary
    // adopt bind (which would accept a contract-compatible contested survivor).
    const policy = padiPolicy(id("1.1", "mine"), 1);
    let instance = 1;
    const { endpoint, calls } = fakeEndpoint({
      adopted: true, // bind WOULD adopt if called — must not be called
      policy,
      probe: async () =>
        drainableProbe(id("1.1", "A"), {
          instanceKey: instance,
          hang: instance !== 1, // first drain takes; second would hang
          ceilingMs: 20,
        }),
    });
    // First: drain took → drained-replacing (bind runs to spawn/adopt).
    await converge(endpoint);
    instance = 2;
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("cross-supervisor");
    if (out.kind === "refused") expect(out.adopted).toBe(false);
    // Second converge must NOT have called the adopt bind.
    // calls from first converge: one adoptOrSpawnOrRefuse; second: none extra for refuse path.
    expect(calls.filter((c) => c === "adoptOrSpawnOrRefuse").length).toBe(1);
  });

  it("two-supervisor drain war ends in cross-supervisor, not livelock", async () => {
    // Supervisor drains lineage (A, instance 1). The "other supervisor" respawns
    // the same build under a NEW instance. Budget must give up as cross-supervisor
    // rather than draining forever.
    const policy = padiPolicy(id("1.1", "mine"), 3);
    const budget = createDrainBudget(policy);
    let drains = 0;

    // First dial: drain old build instance 1 (takes).
    const first = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: 1 },
      budget,
      drain: async () => {
        drains++;
      },
      awaitExit: async () => {},
      ceilingMs: 50,
      log: silent,
    });
    expect(first.kind).toBe("replaced");
    expect(drains).toBe(1);

    // Second dial: same build, DIFFERENT instance → cross-supervisor, no drain.
    const second = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: 2 },
      budget,
      drain: async () => {
        drains++;
      },
      awaitExit: async () => {},
      ceilingMs: 50,
      log: silent,
    });
    expect(drains).toBe(1);
    expect(second.kind).toBe("refuse");
    if (second.kind === "refuse") {
      expect(second.anomaly.kind).toBe("cross-supervisor");
    }
  });

  it("budget exhaustion on SAME instance → adopt-stale (onGiveUp)", async () => {
    const policy = padiPolicy(id("1.1", "B"), 1);
    const budget = createDrainBudget(policy);
    // Drain does not take (awaitExit never resolves before ceiling).
    const hang = () => new Promise<void>(() => {});
    const first = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: 1 },
      budget,
      drain: async () => {},
      awaitExit: hang,
      ceilingMs: 20,
      log: silent,
    });
    // Not-taken path falls through to give-up with adopt-stale.
    expect(first.kind).toBe("adopt");
    if (first.kind === "adopt") {
      expect(first.anomaly?.kind).toBe("adopted-stale");
    }

    // Second attempt: already at maxAttempts → immediate give-up, no hang.
    const second = await convergeAdmit({
      running: { ...id("1.1", "A"), instanceKey: 1 },
      budget,
      drain: async () => {
        throw new Error("should not drain again");
      },
      awaitExit: hang,
      ceilingMs: 20,
      log: silent,
    });
    expect(second.kind).toBe("adopt");
    if (second.kind === "adopt") {
      expect(second.anomaly?.kind).toBe("adopted-stale");
    }
  });
});

describe("converge — Pin 1: drain policy requires a drainable handshake (compile-time)", () => {
  it("a not-drainable policy CANNOT declare a drain arm or budget", () => {
    const badPolicy: ConvergencePolicy<"not-drainable"> = {
      capability: "not-drainable",
      baked: id("1.0", "x"),
      onContractSkew: { kind: "recycle" },
      // @ts-expect-error Pin 1: drain-and-replace requires a drainable handshake
      onBuildMismatch: { kind: "drain-and-replace" },
      // @ts-expect-error Pin 1: drainBudget is unspellable on not-drainable
      drainBudget: { maxAttempts: 1, onGiveUp: "adopt-stale" },
    };
    expect(badPolicy.onContractSkew.kind).toBe("recycle");
  });
});
