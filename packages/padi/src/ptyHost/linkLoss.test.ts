import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { type ConvergenceIdentity, daemonBuild } from "@kolu/surface-daemon";
import {
  type EndpointState,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";
import { createEndpointForKoluTest } from "@kolu/surface-daemon-supervisor/createEndpoint.kolu.testlib";
import { Effect } from "effect";
import type { PtyHostClient, PtyHostIdentity } from "kaval";
import { afterEach, describe, expect, it } from "vitest";
import type { KavalObservation } from "../kavalObservation.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { unreachableDispatch } from "./dispatch.testlib.ts";
import {
  requireEndpointClaim,
  withConvergeClaim,
  withRestartClaim,
} from "./endpointClaim.ts";
import { type LinkLossHealer, startLinkLossHealer } from "./linkLoss.ts";
import {
  type ConvergeVerdict,
  convergeAndReconcile,
} from "./reconcileConverged.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Observed = KavalObservation["kind"];

const SERVING = Effect.succeed<Observed>("healthy");

const NO_ANNOUNCE = (): void => {};

async function waitFor(
  what: string,
  ready: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(2);
  }
}

const STARTED_AT = 1;

const CONTRACT = "1.1";

const residentPolicy = {
  capability: "not-drainable" as const,
  baked: { contractVersion: CONTRACT, build: { kind: "off-nix" as const } },
  onContractSkew: { kind: "refuse" as const },
  onBuildMismatch: { kind: "nudge-human" as const },
};

const residentIdentity: ConvergenceIdentity = {
  contractVersion: CONTRACT,
  build: daemonBuild("resident"),
};

type KavalTestEndpoint = ReturnType<
  typeof createEndpointForKoluTest<
    PtyHostClient,
    PtyHostIdentity,
    KavalConnectionMetadata
  >
>;

interface Resident {
  readonly endpoint: KavalTestEndpoint;
  dropLink(): void;
  readonly states: EndpointState[];
  dispose(): void;
}

async function residentKaval(
  observe: (state: EndpointState) => void,
): Promise<Resident> {
  const dir = mkdtempSync(join(tmpdir(), "link-loss-"));
  const socketPath = join(dir, "k.sock");
  const gatePath = join(dir, "k.pid");
  const server: Server = createServer((c) => c.on("error", () => {}));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  writeFileSync(gatePath, `${process.pid}\n`);

  const states: EndpointState[] = [];
  let closers: Array<() => void> = [];

  const endpoint = createEndpointForKoluTest<
    PtyHostClient,
    PtyHostIdentity,
    KavalConnectionMetadata
  >({
    hostId: "local-kaval-test",
    home: { dir, gatePath, socketPath },
    policy: residentPolicy,
    probe: () =>
      Effect.sync(() => ({
        capability: "not-drainable" as const,
        identity: residentIdentity,
        instanceKey: instanceKeyFromStartedAt(STARTED_AT),
        dispose: () => {},
      })),
    driver: {
      spawn: Effect.fail(
        new Error("the resident survivor must be adopted, never replaced"),
      ),
    },
    connect: () =>
      Effect.sync(() => {
        closers = [];
        return {
          client: {} as PtyHostClient,
          identity: { staleKey: "", navigableCommit: "" },
          startedAt: STARTED_AT,
          metadata: {
            contractVersion: CONTRACT,
            pid: 4242,
            dispatch: unreachableDispatch,
          },
          dispose: () => {},
          onClose: (cb: () => void) => {
            closers.push(cb);
          },
        };
      }),
    log: silentLogger,
    onStatus: (_hostId, status) => {
      observe(status.state);
      states.push(status.state);
    },
    socketReadyMs: 200,
    socketPollMs: 5,
    adoptConnectAttempts: 1,
    adoptConnectRetryMs: 1,
  });

  return {
    endpoint,
    dropLink: () => {
      for (const cb of closers) cb();
    },
    states,
    dispose: () => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const residents: Resident[] = [];
const healers: LinkLossHealer[] = [];

afterEach(async () => {
  for (const h of healers.splice(0)) h.observe("dead");
  await delay(0);
  for (const r of residents.splice(0)) r.dispose();
});

describe("mid-session link loss re-converges itself (#2182)", () => {
  it("re-ADOPTS the resident daemon after the held connection closes, runs the boot's own hooks, and stamps the LINK restore — never the recycle-recovery (#2184)", async () => {
    let adoptions = 0;
    let parks = 0;
    let recoveries = 0;
    let linkRestores = 0;
    const hooks = {
      onAdopted: Effect.sync(() => {
        adoptions += 1;
      }),
      onNotAdopted: () => {
        parks += 1;
      },
      onAdoptFailure: "recycle" as const,
    };

    let healer: LinkLossHealer | undefined;
    const resident = await residentKaval((s) => healer?.observe(s));
    residents.push(resident);
    const ep = resident.endpoint;
    healer = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: convergeAndReconcile(ep, hooks),
      onRecovered: (verdict) => {
        if (verdict === "adopted") linkRestores += 1;
        else recoveries += 1;
      },
      backoffMs: 10,
    });
    healers.push(healer);

    expect(await Effect.runPromise(convergeAndReconcile(ep, hooks))).toBe(
      "adopted",
    );
    expect(adoptions).toBe(1);
    expect(ep.current()).toBeDefined();

    resident.dropLink();
    expect(resident.states.at(-1)).toBe("degraded");
    expect(ep.current()).toBeUndefined();

    await waitFor(
      "the link-loss heal to re-converge",
      () => linkRestores === 1,
    );

    expect(ep.current()).toBeDefined();
    expect(resident.states.at(-1)).toBe("connected");
    expect(adoptions).toBe(2);
    expect(parks).toBe(0);
    expect(linkRestores).toBe(1);
    expect(recoveries).toBe(0);
  });

  it("stamps the recycle-recovery, NOT the link restore, when the heal lands on a daemon with no survivors (#2184)", async () => {
    let linkRestores = 0;
    let recoveries = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.suspend(() => {
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>("no-survivors");
      }),
      onRecovered: (verdict) => {
        if (verdict === "adopted") linkRestores += 1;
        else recoveries += 1;
      },
      backoffMs: 5,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor("the heal to settle on no survivors", () => recoveries === 1);
    expect(linkRestores).toBe(0);
  });

  it("does NOT converge when the daemon is GONE, and keeps asking — standing down would sit out the daemon's return", async () => {
    let converges = 0;
    let observed: Observed = "unreachable";
    const healer = startLinkLossHealer({
      kavalResidency: Effect.suspend(() => Effect.succeed(observed)),
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    await delay(60);
    expect(converges).toBe(0);

    observed = "healthy";
    await waitFor(
      "the heal to resume once the socket is served again",
      () => converges === 1,
    );
  });

  it("does NOT converge on a STUCK daemon either, but keeps re-checking — a busy kaval must not be given up on", async () => {
    let converges = 0;
    let observed: Observed = "wedged";
    const healer = startLinkLossHealer({
      kavalResidency: Effect.suspend(() => Effect.succeed(observed)),
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    await delay(40);
    expect(converges).toBe(0);
    observed = "healthy";
    await waitFor(
      "the heal to resume once the daemon answers",
      () => converges === 1,
    );
  });

  it("does NOT heal a daemon that was never connected — a dead-on-boot endpoint keeps its old behaviour", async () => {
    let converges = 0;
    const healer = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connecting");
    healer.observe("degraded");
    await delay(40);
    expect(converges).toBe(0);
  });
});

describe("the heal's retry backs off, and stops the moment the link is back", () => {
  it("does NOT announce an `incomplete` heal, and keeps retrying it even though the endpoint is connected", async () => {
    const announced: ConvergeVerdict[] = [];
    let attempts = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.suspend(() => {
        attempts += 1;
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>(
          attempts < 3 ? "incomplete" : "adopted",
        );
      }),
      onRecovered: (v) => {
        announced.push(v);
      },
      backoffMs: 20,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");

    await waitFor("the heal to finish after two incomplete rounds", () =>
      announced.includes("adopted"),
    );
    expect(attempts).toBe(3);
    expect(announced).toEqual(["adopted"]);

    const secondIncidentAt = Date.now();
    healed.observe("degraded");
    await waitFor("the NEXT incident to start promptly", () => attempts === 4);
    expect(Date.now() - secondIncidentAt).toBeLessThan(60);
  });

  it("retries a failed re-converge on a doubled backoff, then stops on success with ONE recovery stamp", async () => {
    const startedAt: number[] = [];
    let recoveries = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.suspend(() => {
        startedAt.push(Date.now());
        if (startedAt.length === 1) {
          return Effect.fail(new Error("dial refused"));
        }
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>("adopted");
      }),
      onRecovered: () => {
        recoveries += 1;
      },
      backoffMs: 20,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor("two re-converge attempts", () => startedAt.length === 2);

    const gap = (startedAt[1] ?? 0) - (startedAt[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(30);
    await delay(120);
    expect(startedAt).toHaveLength(2);
    expect(recoveries).toBe(1);
  });
});

describe("a heal that has to replace the daemon does not wait on itself (#2184)", () => {
  it("runs the fail-closed recycle inside the heal's OWN claim, and leaves the endpoint claimable afterwards", async () => {
    let replacements = 0;
    const verdicts: ConvergeVerdict[] = [];
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: withConvergeClaim(
        Effect.sync(() => {
          requireEndpointClaim("the fail-closed recycle");
          replacements += 1;
          healer?.observe("connected");
          return "recycled" as const;
        }),
      ),
      onRecovered: (verdict) => {
        verdicts.push(verdict);
      },
      backoffMs: 5,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor(
      "the fail-closed heal to settle",
      () => verdicts.length === 1,
    );
    expect(replacements).toBe(1);
    expect(verdicts).toEqual<ConvergeVerdict[]>(["recycled"]);

    await expect(
      Promise.race([
        Effect.runPromise(withRestartClaim(Effect.void)).then(() => "claimed"),
        delay(500).then(() => "hung"),
      ]),
    ).resolves.toBe("claimed");
  });

  it("refuses an endpoint replacement that nobody has claimed", () => {
    expect(() => requireEndpointClaim("a stray recycle")).toThrow(/claim/);
  });
});

describe("a deliberate restart is never mistaken for a lost link", () => {
  it("the endpoint's emit-guard repaints a restart's own close as `restarting`, so the healer never arms", async () => {
    let converges = 0;
    let healer: LinkLossHealer | undefined;
    const resident = await residentKaval((s) => healer?.observe(s));
    residents.push(resident);
    const ep = resident.endpoint;
    healer = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    await Effect.runPromise(
      convergeAndReconcile(ep, { onAdoptFailure: "recycle" }),
    );
    expect(resident.states.at(-1)).toBe("connected");

    await Effect.runPromise(
      ep.holdRestarting(
        Effect.promise(async () => {
          resident.dropLink();
          await delay(5);
        }),
      ),
    );

    expect(resident.states).toContain("restarting");
    const sinceConnected = resident.states.slice(
      resident.states.lastIndexOf("connected") + 1,
    );
    expect(sinceConnected).not.toContain("degraded");
    await delay(40);
    expect(converges).toBe(0);
  });

  it("a heal already armed stands down while a restart holds the claim, and never converges behind it", async () => {
    let converges = 0;
    const healer = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 10,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");

    let release = (): void => {};
    const restarting = Effect.runPromise(
      withRestartClaim(
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
      ),
    );

    await delay(80);
    expect(converges).toBe(0);

    release();
    await restarting;
    healer.observe("connected");
    await delay(60);
    expect(converges).toBe(0);
  });

  it("a restart WAITS OUT a heal that is already mid-converge, so the two can never overlap", async () => {
    let converging = false;
    let restartRan = false;
    let ranDuringConverge = false;
    let release = (): void => {};
    const healer = startLinkLossHealer({
      kavalResidency: SERVING,
      reconverge: Effect.promise(async () => {
        converging = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        converging = false;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    await waitFor("the heal to start converging", () => converging);

    const restarted = Effect.runPromise(
      withRestartClaim(
        Effect.sync(() => {
          restartRan = true;
          ranDuringConverge = converging;
        }),
      ),
    );
    await delay(40);
    expect(restartRan).toBe(false);

    release();
    await restarted;
    expect(restartRan).toBe(true);
    expect(ranDuringConverge).toBe(false);
    healer.observe("connected");
  });
});
