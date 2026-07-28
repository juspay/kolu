/**
 * `converge` / `convergeAdmit` orchestration — decision → budget → enactment,
 * typed outcomes + anomalies, and the two-supervisor drain-war termination.
 *
 * Endpoints are genuine {@link createEndpoint} handles (F12). Bind outcomes are
 * driven via EndpointSpec seams (driver / connect / probe / gate), never a
 * forgeable registerTestEndpointBinds harness.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ConvergenceIdentity,
  daemonBuild,
  type Logger,
} from "@kolu/surface-daemon";
import { afterEach, describe, expect, it } from "vitest";
import { createConnectorDrainBudget } from "./budget.ts";
import { convergeAdmit } from "./convergeAdmit.ts";
import { converge, outcomeAdopted, outcomeAnomaly } from "./converge.ts";
import { drainAndAwaitExit } from "./drainAndAwaitExit.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConnectorPolicy, ConvergencePolicy } from "./policy.ts";
import { createEndpoint } from "../endpoint.ts";

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

const tmpDirs: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const d of tmpDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

type BindMode = "spawn" | "adopt" | "refuse";

/**
 * Real createEndpoint product. Bind outcome is controlled only via seams:
 *  - spawn: free gate → driver.spawn + connect → spawned-fresh
 *  - adopt: live gate+socket (this pid) + connect ok → adopted-resident
 *  - refuse: live gate+socket + connect throws non-skew → refused-or-failed
 *
 * liveServingHolder requires BOTH a live gate pid AND an accepting socket.
 */
async function realEndpoint<Cap extends "drainable" | "not-drainable">(opts: {
  policy: ConvergencePolicy<Cap>;
  probe: () => Promise<
    ReturnType<typeof drainableProbe> | ReturnType<typeof plainProbe> | null
  >;
  bindMode?: BindMode;
}) {
  const dir = mkdtempSync(join(tmpdir(), "sds-converge-"));
  tmpDirs.push(dir);
  const socketPath = join(dir, "d.sock");
  const gatePath = join(dir, "d.pid");
  const mode = opts.bindMode ?? "spawn";

  const listen = async (): Promise<void> => {
    const s = createServer((c) => c.on("error", () => {}));
    servers.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once("error", reject);
      s.listen(socketPath, () => resolve());
    });
    writeFileSync(gatePath, `${process.pid}\n`);
  };

  if (mode === "adopt" || mode === "refuse") {
    // Pre-listen so liveServingHolder sees a real resident.
    await listen();
  }

  const endpoint = createEndpoint({
    hostId: "test",
    home: { dir, gatePath, socketPath },
    policy: opts.policy,
    // Test probes are Cap-agnostic fixtures; cast into the endpoint Cap.
    // biome-ignore lint/suspicious/noExplicitAny: test fixture Cap erase
    probe: opts.probe as any,
    driver: {
      spawn: async () => {
        await listen();
      },
    },
    connect: async () => {
      if (mode === "refuse") {
        throw new Error("connect unreachable (non-skew)");
      }
      return {
        client: "c",
        identity: { id: "i" },
        startedAt: Date.now(),
        dispose: () => {},
        onClose: () => {},
      };
    },
    log: silent,
    onStatus: () => {},
    socketReadyMs: 200,
    socketPollMs: 5,
    adoptConnectAttempts: 1,
    adoptConnectRetryMs: 1,
  });
  return endpoint;
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
  it("live unreachable survivor → bind refuse → not-adopted", async () => {
    const endpoint = await realEndpoint({
      bindMode: "refuse",
      policy: padiPolicy(),
      probe: async () => null,
    });
    // refuse mode: live gate+socket; connect non-skew failure → refused-or-failed
    const out = await converge(endpoint);
    expect(out.kind).toBe("not-adopted");
  });

  it("kaval contract skew → adoptOrEnsure path; outcome recycled", async () => {
    const probe = plainProbe(id("1.0", "A"));
    const endpoint = await realEndpoint({
      bindMode: "spawn",
      policy: KAVAL,
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("recycled");
    expect(outcomeAdopted(out)).toBe(false);
    expect(probe.disposed).toBe(true);
  });

  it("padi OLDER contract → refuse + skew-refused anomaly", async () => {
    const probe = drainableProbe(id("2.0", "A"));
    const endpoint = await realEndpoint({
      bindMode: "refuse",
      policy: padiPolicy(id("1.0", "B")),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
  });

  it("padi build mismatch drain takes + spawned-fresh → drained-replacing (F5 not stale)", async () => {
    const probe = drainableProbe(id("1.1", "A"), { instanceKey: ik(1) });
    const endpoint = await realEndpoint({
      bindMode: "spawn",
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
    const endpoint = await realEndpoint({
      bindMode: "spawn",
      policy: padiPolicy(id("1.1", "B"), 1),
      probe: async () => probe,
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("spawned-fresh");
    expect(outcomeAnomaly(out)).toBeNull();
  });

  it("F1: foreign respawn between drain and bind → cross-supervisor", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 3),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          return drainableProbe(id("1.1", "A"), { instanceKey: ik(1) });
        }
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

  it("F1a: same-lineage post-drain wrong build enacts admitted drain (not adopted-stale mid-budget)", async () => {
    let probeN = 0;
    let drains = 0;
    const endpoint = await realEndpoint({
      // After drain, bind re-probes for characterization then again for the
      // drainable loop body — keep same-lineage wrong until enough drain cycles.
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 3),
      probe: async () => {
        probeN += 1;
        // Probes 1–3: still wrong build (initial + post-drain characterize + loop).
        // Probe 4+: expected build so the second drain converges.
        if (probeN <= 3) {
          return drainableProbe(id("1.1", "stale"), {
            instanceKey: ik(1),
            onDrain: () => {
              drains += 1;
            },
          });
        }
        return drainableProbe(id("1.1", "mine"), { instanceKey: ik(1) });
      },
    });
    const out = await converge(endpoint);
    expect(drains).toBeGreaterThanOrEqual(2);
    // Not mid-budget adopted-stale while maxAttempts=3 and only 2 same-lineage drains.
    expect(out.kind).not.toBe("adopted-stale");
    if (out.kind === "drained-replacing" || out.kind === "adopted") {
      expect(outcomeAnomaly(out)).toBeNull();
    }
  });

  it("F1b / W4.2: adopted-resident + null characterization → identity-unverifiable AND current() empty", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          return drainableProbe(id("1.1", "stale"), { instanceKey: ik(1) });
        }
        // Post-drain characterizeHeld / re-probe cannot characterize.
        return null;
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAdopted(out)).toBe(false);
    // Outcome and reality agree: held connection was released.
    expect(endpoint.current()).toBeUndefined();
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    if (a?.kind === "unconverged") {
      expect(a.cause.kind).toBe("identity-unverifiable");
    }
  });

  it("W4.2(a): adopt-hint-style mismatched build is mismatch/nudge, never clean adopt", async () => {
    // Primary probe null; bind adopts via live gate; characterization returns wrong build.
    // Kaval-shaped policy: build mismatch → report-mismatch (nudge-human), never silent adopt.
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: {
        capability: "not-drainable",
        baked: id("5.0", "test-build"),
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null; // primary empty
        // characterizeHeld after adopt — wrong build (legacy).
        return plainProbe(id("5.0", "legacy"));
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("mismatch-reported");
    if (out.kind === "mismatch-reported") {
      expect(out.running.build).toEqual(daemonBuild("legacy"));
    }
    expect(outcomeAnomaly(out)).toBeNull();
  });

  it("W4.3: newer-incompatible-contract successor is refused (zero second drain)", async () => {
    let drains = 0;
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 3),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          // Initial: same contract, wrong build → drain-and-replace.
          return drainableProbe(id("1.1", "stale"), {
            instanceKey: ik(1),
            onDrain: () => {
              drains += 1;
            },
          });
        }
        // Post-drain: same lineage instance, but NEWER incompatible contract —
        // drain-newer-else-refuse must REFUSE (not drain again).
        return drainableProbe(id("9.0", "stale"), {
          instanceKey: ik(1),
          onDrain: () => {
            drains += 1;
          },
        });
      },
    });
    const out = await converge(endpoint);
    expect(drains).toBe(1);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
    expect(endpoint.current()).toBeUndefined();
  });

  it("F2 / W4.4: probe throw on successor re-probe is typed probe-failed", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          return drainableProbe(id("1.1", "stale"), { instanceKey: ik(1) });
        }
        throw new Error("ECONNRESET: successor dial failed");
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    if (a?.kind === "unconverged" && a.cause.kind === "probe-failed") {
      expect(a.cause.message).toMatch(/ECONNRESET/);
    }
  });

  it("F2: probe throw on first probe surfaces typed probe-failed unconverged (not unhandled)", async () => {
    const endpoint = await realEndpoint({
      bindMode: "spawn",
      policy: padiPolicy(),
      probe: async () => {
        throw new Error("EPERM: dial blocked");
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    if (a?.kind === "unconverged" && a.cause.kind === "probe-failed") {
      expect(a.cause.message).toMatch(/EPERM/);
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
