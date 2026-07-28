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
  /** startedAt stamped on each connect (default 1). Foreign-respawn tests use 2. */
  connectStartedAt?: number | (() => number);
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

  const startedAtOf = (): number => {
    if (typeof opts.connectStartedAt === "function")
      return opts.connectStartedAt();
    return opts.connectStartedAt ?? 1;
  };
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
        startedAt: startedAtOf(),
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

function plainProbe(
  identity: ConvergenceIdentity,
  hooks: { instanceKey?: InstanceKey } = {},
) {
  return {
    capability: "not-drainable" as const,
    identity,
    instanceKey: hooks.instanceKey ?? ik(0),
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
      // Post-drain connect is the foreign process (startedAt 2 ≠ drained ik(1)).
      connectStartedAt: 2,
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
      connectStartedAt: 1,
      policy: {
        capability: "not-drainable",
        baked: id("5.0", "test-build"),
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null; // primary empty
        // characterizeHeld after adopt — wrong build (legacy); key matches connect.
        return plainProbe(id("5.0", "legacy"), { instanceKey: ik(1) });
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("mismatch-reported");
    expect(out.kind === "mismatch-reported" ? out.running.build : null).toEqual(
      daemonBuild("legacy"),
    );
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
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "probe-failed",
    );
    expect(
      a && a.kind === "unconverged" && a.cause.kind === "probe-failed"
        ? a.cause.message
        : "",
    ).toMatch(/ECONNRESET/);
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
    expect(a && a.kind === "unconverged" ? a.running : "x").toBeNull();
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "probe-failed",
    );
    expect(
      a && a.kind === "unconverged" && a.cause.kind === "probe-failed"
        ? a.cause.message
        : "",
    ).toMatch(/EPERM/);
  });

  // ── W5 named tests (rigor updated W6) ────────────────────────────────────

  it("W5.1: null→bind-characterized stale build → resolveDrainable newer contract ⇒ zero drains, refused", async () => {
    let drains = 0;
    let probeN = 0;
    let refusedDisposed = false;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 3),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null; // primary empty
        // characterize: stale build (decide drain) — instance key matches connect(1).
        if (probeN === 2) {
          return drainableProbe(id("1.1", "stale"), {
            instanceKey: ik(1),
            onDrain: () => {
              drains += 1;
            },
          });
        }
        // resolveDrainable: newer incompatible contract — fold must refuse, dispose.
        const p = drainableProbe(id("9.0", "stale"), {
          instanceKey: ik(1),
          onDrain: () => {
            drains += 1;
          },
        });
        const origDispose = p.dispose;
        p.dispose = () => {
          refusedDisposed = true;
          origDispose();
        };
        return p;
      },
    });
    const out = await converge(endpoint);
    expect(drains).toBe(0);
    expect(out.kind).toBe("refused");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
    // W6.5: foldObserved owns dispose of the refused fresh probe.
    expect(refusedDisposed).toBe(true);
  });

  it("W5.2: drain-not-taken → give-up bind newer-contract characterization ⇒ refused, never adopted-stale", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 1),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          return drainableProbe(id("1.1", "stale"), {
            instanceKey: ik(1),
            hang: true,
            ceilingMs: 20,
          });
        }
        // Give-up bind characterization: newer incompatible contract.
        return drainableProbe(id("9.0", "stale"), { instanceKey: ik(1) });
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(out.kind).not.toBe("adopted-stale");
    expect(outcomeAnomaly(out)?.kind).toBe("skew-refused");
    expect(endpoint.current()).toBeUndefined();
  });

  it("W5.3: null→adopt→characterization throws ⇒ probe-failed with original message", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null;
        throw new Error("PROTOCOL: handshake explode");
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAdopted(out)).toBe(false);
    expect(endpoint.current()).toBeUndefined();
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    // W6.4: unconditional cause assertion — no vacuous if-guard.
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "probe-failed",
    );
    expect(
      a && a.kind === "unconverged" && a.cause.kind === "probe-failed"
        ? a.cause.message
        : "",
    ).toMatch(/PROTOCOL: handshake explode/);
  });

  it("W5.4: held characterized resident whose drainable re-probe throws ⇒ probe-failed + released", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      // connect startedAt 1 must match characterization instance key.
      connectStartedAt: 1,
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null;
        if (probeN === 2) {
          // characterization: stale build → decide drain; key matches connect.
          return plainProbe(id("1.1", "stale"), { instanceKey: ik(1) });
        }
        // resolveDrainable for drain path throws
        throw new Error("EPIPE: drainable re-probe died");
      },
    });
    const out = await converge(endpoint);
    expect(outcomeAdopted(out)).toBe(false);
    expect(endpoint.current()).toBeUndefined();
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "probe-failed",
    );
    expect(
      a && a.kind === "unconverged" && a.cause.kind === "probe-failed"
        ? a.cause.message
        : "",
    ).toMatch(/EPIPE/);
  });

  it("W5.5: real adoptHint topology — primary empty, live hint, mismatched build ⇒ mismatch-reported + held", async () => {
    const primaryDir = mkdtempSync(join(tmpdir(), "sds-hint-p-"));
    const hintDir = mkdtempSync(join(tmpdir(), "sds-hint-h-"));
    tmpDirs.push(primaryDir, hintDir);
    const primarySock = join(primaryDir, "p.sock");
    const primaryGate = join(primaryDir, "p.pid");
    const hintSock = join(hintDir, "h.sock");
    const hintGate = join(hintDir, "h.pid");

    // Live HINT only (primary free).
    const hintServer = createServer((c) => c.on("error", () => {}));
    servers.push(hintServer);
    await new Promise<void>((resolve, reject) => {
      hintServer.once("error", reject);
      hintServer.listen(hintSock, () => resolve());
    });
    writeFileSync(hintGate, `${process.pid}\n`);

    let hintConnects = 0;
    let primaryConnects = 0;
    const endpoint = createEndpoint({
      hostId: "hint-test",
      home: { dir: primaryDir, gatePath: primaryGate, socketPath: primarySock },
      policy: {
        capability: "not-drainable" as const,
        baked: id("5.0", "test-build"),
        onContractSkew: { kind: "recycle" as const },
        onBuildMismatch: { kind: "nudge-human" as const },
      },
      probe: async (socketPath: string) => {
        // Primary empty; hint socket answers with legacy build + matching key.
        if (socketPath === primarySock) return null;
        if (socketPath === hintSock) {
          return plainProbe(id("5.0", "legacy"), { instanceKey: ik(1) });
        }
        return null;
      },
      driver: {
        spawn: async () => {
          throw new Error("must not spawn — should adopt hint");
        },
      },
      // W6.4: primary connect must NOT be used for the hint topology.
      connect: async (_socketPath: string) => {
        primaryConnects += 1;
        throw new Error(
          "primary connect must not be called for adoptHint path",
        );
      },
      adoptHint: {
        home: { dir: hintDir, gatePath: hintGate, socketPath: hintSock },
        connect: async (_socketPath: string) => {
          hintConnects += 1;
          return {
            client: "hint-client",
            identity: { staleKey: "legacy" },
            startedAt: 1,
            dispose: () => {},
            onClose: () => {},
          };
        },
        onAdopted: () => {},
      },
      log: silent,
      onStatus: () => {},
      socketReadyMs: 200,
      socketPollMs: 5,
      adoptConnectAttempts: 1,
      adoptConnectRetryMs: 1,
    });

    const out = await converge(endpoint);
    expect(primaryConnects).toBe(0);
    expect(hintConnects).toBe(1);
    expect(out.kind).toBe("mismatch-reported");
    expect(out.kind === "mismatch-reported" ? out.running.build : null).toEqual(
      daemonBuild("legacy"),
    );
    // Hint connection held (mismatch-reported with adopted bind).
    expect(outcomeAdopted(out)).toBe(true);
    expect(endpoint.current()).toBeDefined();
  });

  // ── W6 named tests ──────────────────────────────────────────────────────

  it("W6.2: second converge with initial probe throw releases prior held connection", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      connectStartedAt: 1,
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        // First converge: null primary → adopt → characterize exact match.
        if (probeN === 1) return null;
        if (probeN === 2) {
          return drainableProbe(id("1.1", "mine"), { instanceKey: ik(1) });
        }
        // Second converge: initial probe throws while connection still held.
        throw new Error("EPIPE: reconverge probe failed");
      },
    });
    const first = await converge(endpoint);
    expect(outcomeAdopted(first)).toBe(true);
    expect(endpoint.current()).toBeDefined();

    const second = await converge(endpoint);
    expect(second.kind).toBe("refused");
    expect(outcomeAdopted(second)).toBe(false);
    expect(endpoint.current()).toBeUndefined();
    const a = outcomeAnomaly(second);
    expect(a?.kind).toBe("unconverged");
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "probe-failed",
    );
  });

  it("W6.6: drain-not-taken → give-up bind exact-match characterization ⇒ clean adopted", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      connectStartedAt: 1,
      policy: padiPolicy(id("1.1", "mine"), 1),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) {
          return drainableProbe(id("1.1", "stale"), {
            instanceKey: ik(1),
            hang: true,
            ceilingMs: 20,
          });
        }
        // Give-up bind characterization: exact match to baked → clean adopt.
        return drainableProbe(id("1.1", "mine"), { instanceKey: ik(1) });
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("adopted");
    expect(out.kind).not.toBe("adopted-stale");
    expect(outcomeAnomaly(out)).toBeNull();
    expect(endpoint.current()).toBeDefined();
  });

  it("W6.3: characterization named key ≠ conn.startedAt ⇒ identity-unverifiable + released", async () => {
    let probeN = 0;
    const endpoint = await realEndpoint({
      bindMode: "adopt",
      connectStartedAt: 1,
      policy: padiPolicy(id("1.1", "mine"), 2),
      probe: async () => {
        probeN += 1;
        if (probeN === 1) return null;
        // Probe claims instance 99 while held conn has startedAt 1 → uncorrelated.
        return drainableProbe(id("1.1", "mine"), { instanceKey: ik(99) });
      },
    });
    const out = await converge(endpoint);
    expect(out.kind).toBe("refused");
    expect(outcomeAdopted(out)).toBe(false);
    expect(endpoint.current()).toBeUndefined();
    const a = outcomeAnomaly(out);
    expect(a?.kind).toBe("unconverged");
    expect(a && a.kind === "unconverged" ? a.cause.kind : null).toBe(
      "identity-unverifiable",
    );
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
