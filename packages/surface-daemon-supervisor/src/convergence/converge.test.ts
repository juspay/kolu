/**
 * `converge` orchestration — decision → enactment via the endpoint's existing boot
 * methods, the build fence, drain-failure degradation, and the typed outcome the caller
 * wires. Plus Pin 1 (a non-drainable probe cannot carry a drain policy — a COMPILE error)
 * and the kit's half of Pin 3 (identity is consumed regardless of contract compatibility).
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";
import { describe, expect, it } from "vitest";
import {
  type ConvergeLogger,
  type ConvergenceEndpoint,
  converge,
} from "./converge.ts";
import { createBuildDrainFence } from "./fence.ts";
import type { ConvergencePolicy } from "./policy.ts";

const silent: ConvergeLogger = { info() {}, warn() {}, error() {} };

const KAVAL: ConvergencePolicy<"not-drainable"> = {
  capability: "not-drainable",
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
};
const PADI: ConvergencePolicy<"drainable"> = {
  capability: "drainable",
  onContractSkew: { kind: "drain-newer-else-refuse" },
  onBuildMismatch: { kind: "drain-and-replace" },
};

const id = (contractVersion: string, buildId: string): ConvergenceIdentity => ({
  contractVersion,
  buildId,
});

/** An endpoint spy recording which boot method fired. */
function fakeEndpoint(adopted: boolean) {
  const calls: string[] = [];
  const endpoint: ConvergenceEndpoint = {
    adoptOrSpawnOrRefuse: async () => {
      calls.push("adoptOrSpawnOrRefuse");
      return adopted;
    },
    adoptOrEnsure: async () => {
      calls.push("adoptOrEnsure");
      return adopted;
    },
  };
  return { endpoint, calls };
}

function drainableProbe(
  identity: ConvergenceIdentity,
  hooks: { onDrain?: () => void; throws?: boolean } = {},
) {
  const p = {
    capability: "drainable" as const,
    identity,
    disposed: false,
    drained: false,
    drain: async () => {
      p.drained = true;
      hooks.onDrain?.();
      if (hooks.throws) throw new Error("drain never landed");
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
  it("no survivor → adoptOrSpawnOrRefuse spawns; outcome spawned", async () => {
    const { endpoint, calls } = fakeEndpoint(false);
    const out = await converge({
      endpoint,
      baked: id("1.1", "B"),
      probe: async () => null,
      policy: PADI,
      buildFence: createBuildDrainFence(),
      log: silent,
    });
    expect(out.kind).toBe("spawned");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });

  it("kaval contract skew → adoptOrEnsure (recycle); outcome recycled; probe disposed", async () => {
    const { endpoint, calls } = fakeEndpoint(false);
    const probe = plainProbe(id("1.0", "A"));
    const out = await converge({
      endpoint,
      baked: id("2.0", "B"),
      probe: async () => probe,
      policy: KAVAL,
      buildFence: createBuildDrainFence(),
      log: silent,
    });
    expect(out.kind).toBe("recycled");
    expect(calls).toEqual(["adoptOrEnsure"]);
    expect(probe.disposed).toBe(true);
  });

  it("kaval build mismatch → mismatch-reported (no drain, adopts the compatible survivor)", async () => {
    const { endpoint, calls } = fakeEndpoint(true);
    const probe = plainProbe(id("1.1", "A"));
    const out = await converge({
      endpoint,
      baked: id("1.1", "B"),
      probe: async () => probe,
      policy: KAVAL,
      buildFence: createBuildDrainFence(),
      log: silent,
    });
    expect(out).toMatchObject({
      kind: "mismatch-reported",
      running: id("1.1", "A"),
    });
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });

  it("padi build mismatch → drains, spends the fence, then spawns own; outcome drained-replacing(build)", async () => {
    const { endpoint, calls } = fakeEndpoint(false);
    const fence = createBuildDrainFence();
    const probe = drainableProbe(id("1.1", "A"));
    const out = await converge({
      endpoint,
      baked: id("1.1", "B"),
      probe: async () => probe,
      policy: PADI,
      buildFence: fence,
      log: silent,
    });
    expect(probe.drained).toBe(true);
    expect(fence.hasFired()).toBe(true);
    expect(out).toMatchObject({ kind: "drained-replacing", axis: "build" });
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
    expect(probe.disposed).toBe(true);
  });

  it("padi reconnect with the SAME fence never re-drains → adopt", async () => {
    const fence = createBuildDrainFence();
    let drains = 0;
    const call = () =>
      converge({
        endpoint: fakeEndpoint(false).endpoint,
        baked: id("1.1", "B"),
        probe: async () =>
          drainableProbe(id("1.1", "A"), { onDrain: () => drains++ }),
        policy: PADI,
        buildFence: fence,
        log: silent,
      });
    await call();
    await call();
    await call();
    expect(drains).toBe(1);
  });

  it("padi drain FAILURE does not throw; fence stays spent; endpoint still binds (degraded)", async () => {
    const { endpoint, calls } = fakeEndpoint(true);
    const fence = createBuildDrainFence();
    const probe = drainableProbe(id("1.1", "A"), { throws: true });
    const out = await converge({
      endpoint,
      baked: id("1.1", "B"),
      probe: async () => probe,
      policy: PADI,
      buildFence: fence,
      log: silent,
    });
    expect(fence.hasFired()).toBe(true);
    expect(out.kind).toBe("drained-replacing");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
    expect(probe.disposed).toBe(true);
  });

  it("padi OLDER contract → refuse (never drains); the build id is not even consulted", async () => {
    const { endpoint, calls } = fakeEndpoint(false);
    const probe = drainableProbe(id("2.0", "A"));
    const out = await converge({
      endpoint,
      baked: id("1.0", "B"),
      probe: async () => probe,
      policy: PADI,
      buildFence: createBuildDrainFence(),
      log: silent,
    });
    expect(probe.drained).toBe(false);
    expect(out.kind).toBe("refused");
    expect(calls).toEqual(["adoptOrSpawnOrRefuse"]);
  });
});

describe("converge — Pin 1: drain policy requires a drainable handshake (compile-time)", () => {
  it("a not-drainable policy CANNOT declare a drain arm", () => {
    const badPolicy: ConvergencePolicy<"not-drainable"> = {
      capability: "not-drainable",
      onContractSkew: { kind: "recycle" },
      // @ts-expect-error Pin 1: drain-and-replace requires a drainable handshake
      onBuildMismatch: { kind: "drain-and-replace" },
    };
    expect(badPolicy.onContractSkew.kind).toBe("recycle");
  });
});
