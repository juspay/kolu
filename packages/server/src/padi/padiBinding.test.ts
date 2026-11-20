import {
  closeSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { padiRuntimeHome, residentPadiSocket } from "@kolu/padi/assembly";
import type { TerminalAttachFrame } from "@kolu/padi/endpoint";
import { padiKavalSocketPath } from "@kolu/padi/stateRoot";
import { connectPadi } from "@kolu/padi-client/dial";
import { padiGatePath, padiSocketPath } from "@kolu/padi-client/rendezvous";
import {
  PADI_FORWARDING_POLICY,
  PADI_SURFACE_VERSION,
  padiSurface,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { buildSurfaceFace } from "@kolu/surface/client";
import {
  isSurfaceRelayTransportLost,
  isSurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import { directDispatch } from "@kolu/surface/links/direct";
import { DAEMON_BIND_PID_ENV } from "@kolu/surface-daemon";
import {
  type ConvergenceOutcome,
  converge,
  daemonBuild,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import { createEndpointForKoluTest as createEndpoint } from "@kolu/surface-daemon-supervisor/createEndpoint.kolu.testlib";
import { ConnectError, reServeSurface } from "@kolu/surface-remote";
import { Effect, Stream } from "effect";
import {
  AGENT_TOOLS_BAKE_ENV,
  SPAWN_ENV_ALLOWLIST,
  TERMINAL_TOOLS_PATH_ENV,
} from "kolu-pty";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AGENT_DIR_ENV_KEYS,
  daemonEnv,
  ensurePadiBinding,
  ensurePadiBindingWith,
  handlePadiBootFailure,
  localPadiDriver,
  PADI_HOST_ID,
  type PadiLaunchMode,
  PadiAdoptionRefusedError,
  PadiStateRootGoneError,
  padiConnectFailure,
  padiLaunchMode,
  reportFatalBindingError,
  resolvePadiLaunch,
  resolvedPadiSocket,
} from "./padiBinding.ts";
import {
  PADI_DRAIN_TEARDOWN_CEILING_MS,
  padiConvergencePolicy,
} from "./padiConvergence.ts";
import type { PadiSession } from "./padiSession.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function setXdgRuntimeDir(v: string | undefined): void {
  if (v === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = v;
}

createRequire(import.meta.url).resolve("tsx");

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "padi-bind-rt-"));
const prior: Record<string, string | undefined> = {};
const CLEARED = [
  "INVOCATION_ID",
  "KOLU_PADI_BIN",
  "KOLU_STATE_DIR",
  "KOLU_PADI_SPAWN",
] as const;

beforeAll(() => {
  for (const k of [
    "XDG_RUNTIME_DIR",
    "KOLU_KAVAL_SPAWN",
    DAEMON_BIND_PID_ENV,
    ...CLEARED,
  ] as const)
    prior[k] = process.env[k];
  process.env.XDG_RUNTIME_DIR = RUNTIME_ROOT;
  process.env.KOLU_KAVAL_SPAWN = "detached";
  process.env[DAEMON_BIND_PID_ENV] = String(process.pid);
  for (const k of CLEARED) delete process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(prior)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const makeStateRoot = (): string =>
  mkdtempSync(join(tmpdir(), "padi-bind-sr-"));

function gatePid(gatePath: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

const activeSessions: PadiSession[] = [];
const activeStateRoots = new Set<string>();

function reap(stateRoot: string): void {
  const padiGate = padiGatePath(padiSocketPath(stateRoot));
  const kavalGate = join(dirname(padiKavalSocketPath(stateRoot)), "kaval.pid");
  for (const g of [padiGate, kavalGate]) {
    const pid = gatePid(g);
    if (pid !== undefined) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
    }
  }
}

afterEach(async () => {
  for (const s of activeSessions.splice(0)) s.destroy();
  await sleep(50);
  for (const sr of [...activeStateRoots]) reap(sr);
  activeStateRoots.clear();
});

async function bootReServedPadi(stateRoot: string): Promise<{
  session: PadiSession;
  // biome-ignore lint/suspicious/noExplicitAny: the dialed client is walked structurally in the round-trip helper.
  padi: any;
}> {
  activeStateRoots.add(stateRoot);
  const session = ensurePadiBinding({
    stateRoot,
    nixShellWhitelist: "default",
    reconnectDelayMs: 400,
  });
  activeSessions.push(session);
  await Promise.allSettled([session.pin()]);

  const reServed = reServeSurface<typeof padiSurface.spec>({
    source: padiSurface,
    policy: PADI_FORWARDING_POLICY,
    session,
    log: () => {},
  });
  void reServed.done.catch(() => {});

  const face = buildSurfaceFace(reServed.surface, directDispatch(reServed));
  return { session, padi: face.surface };
}

// biome-ignore lint/suspicious/noExplicitAny: `padi` is the structurally-dialed re-served client.
async function roundTripTerminal(padi: any, mark: string): Promise<void> {
  let id: string | undefined;
  for (let i = 0; i < 200 && id === undefined; i++) {
    try {
      ({ id } = (await Effect.runPromise(
        padi.lifecycle.create({
          placement: TOPLEVEL_PLACEMENT,
          cwd: makeStateRoot(),
        }),
      )) as { id: string });
    } catch {
      await sleep(100);
    }
  }
  if (id === undefined)
    throw new Error("re-served lifecycle.create never bound");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  let firstFrame: TerminalAttachFrame | undefined;
  for (let i = 0; i < 200 && firstFrame === undefined; i++) {
    try {
      const attach = Stream.toAsyncIterable(padi.terminalAttach.get({ id }))[
        Symbol.asyncIterator
      ]();
      const first = await attach.next();
      firstFrame = first.value as TerminalAttachFrame;
      await attach.return?.();
    } catch (err) {
      if (
        isSurfaceStdioTransportClosed(err) ||
        isSurfaceRelayTransportLost(err)
      ) {
        await sleep(50);
        continue;
      }
      throw err;
    }
  }
  if (firstFrame === undefined)
    throw new Error(
      "terminalAttach never landed a snapshot across the reconnect",
    );
  if (firstFrame.kind !== "snapshot")
    throw new Error(
      `terminalAttach answered "${firstFrame.kind}" where the contract promises a snapshot first`,
    );
  expect(typeof firstFrame.data).toBe("string");
  expect(firstFrame.grid).toEqual({
    cols: expect.any(Number),
    rows: expect.any(Number),
  });

  await Effect.runPromise(
    padi.lifecycle.sendInput({ id, data: `echo ${mark}\r` }),
  );
  let screen = "";
  for (let i = 0; i < 160 && !screen.includes(mark); i++) {
    screen = await Effect.runPromise(padi.screen.state({ id }));
    if (!screen.includes(mark)) await sleep(50);
  }
  expect(screen).toContain(mark);
}

describeDaemon("kolu-server padi binder — cutover acceptance", () => {
  it("binds a spawned padi and the re-served surface round-trips a terminal", async () => {
    const { session, padi } = await bootReServedPadi(makeStateRoot());
    await roundTripTerminal(padi, "BINDMARK");

    expect(session.convergence()).toBeNull();
    let id = session.identity();
    for (let i = 0; i < 100 && id.kind === "disconnected"; i++) {
      await sleep(50);
      id = session.identity();
    }
    expect(id.kind).toBe("identified");
    if (id.kind !== "identified")
      throw new Error("bound padi never surfaced an identity");
    expect(id.baked.contractVersion).toBe(PADI_SURFACE_VERSION);
    expect(id.startedAt).toBeGreaterThan(0);
  }, 60000);

  it("reconnects when padi dies, and the re-served surface round-trips again", async () => {
    const stateRoot = makeStateRoot();
    const { session, padi } = await bootReServedPadi(stateRoot);
    await roundTripTerminal(padi, "FIRST");

    const seenLines: string[] = [];
    const unsub = session.onState((s) => {
      seenLines.push(...s.log.map((e) => e.line));
    });

    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    await roundTripTerminal(padi, "SECOND");
    unsub();

    expect(seenLines.some((l) => l.includes("endpoint link down"))).toBe(true);
    expect(seenLines.some((l) => l.includes("agent exited"))).toBe(false);
  }, 90000);

  it("a kolu-server (binder) restart keeps padi's registry WARM — adopts, never respawns (done-criterion b)", async () => {
    const stateRoot = makeStateRoot();
    const first = await bootReServedPadi(stateRoot);

    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = (await Effect.runPromise(
          first.padi.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: makeStateRoot(),
          }),
        )) as { id: string });
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");
    await Effect.runPromise(
      first.padi.lifecycle.sendInput({ id, data: "echo WARMMARK\r" }),
    );
    let screen = "";
    for (let i = 0; i < 160 && !screen.includes("WARMMARK"); i++) {
      screen = await Effect.runPromise(first.padi.screen.state({ id }));
      if (!screen.includes("WARMMARK")) await sleep(50);
    }
    expect(screen).toContain("WARMMARK");

    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();

    first.session.destroy();
    await sleep(400);
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(padiPid as number)).toBe(true);

    const second = await bootReServedPadi(stateRoot);
    const padiPid2 = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid2).toBe(padiPid);

    let warm = "";
    for (let i = 0; i < 200 && !warm.includes("WARMMARK"); i++) {
      warm = await Effect.runPromise<string, unknown>(
        second.padi.screen.state({ id }),
      ).catch(() => warm);
      if (!warm.includes("WARMMARK")) await sleep(50);
    }
    expect(warm).toContain("WARMMARK");
  }, 90000);

  it("a padi death MID-ATTACH ends the held downstream iterator — never splices (done-criterion c)", async () => {
    const stateRoot = makeStateRoot();
    const { padi } = await bootReServedPadi(stateRoot);

    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = (await Effect.runPromise(
          padi.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: makeStateRoot(),
          }),
        )) as { id: string });
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");

    const attach = Stream.toAsyncIterable(padi.terminalAttach.get({ id }))[
      Symbol.asyncIterator
    ]();
    const first = await attach.next();
    const firstFrame = first.value as TerminalAttachFrame;
    if (firstFrame.kind !== "snapshot")
      throw new Error(
        `terminalAttach answered "${firstFrame.kind}" where the contract promises a snapshot first`,
      );
    expect(typeof firstFrame.data).toBe("string");

    const padiPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPid).toBeDefined();
    process.kill(padiPid as number, "SIGTERM");

    async function drainUntilEnd(): Promise<"threw" | "done"> {
      for (;;) {
        let res: IteratorResult<unknown>;
        try {
          res = await attach.next();
        } catch {
          return "threw";
        }
        if (res.done) return "done";
      }
    }
    const outcome = await Promise.race([
      drainUntilEnd(),
      sleep(30000).then(() => "timeout" as const),
    ]);
    expect(outcome).not.toBe("timeout");
    expect(["threw", "done"]).toContain(outcome);
  }, 90000);

  it("a drain ACROSS THE WIRE persists the session — the state-root blob never nulls/shrinks (done-criterion f)", async () => {
    const stateRoot = makeStateRoot();
    const { session, padi } = await bootReServedPadi(stateRoot);

    for (let n = 0; n < 2; n++) {
      let id: string | undefined;
      for (let i = 0; i < 200 && id === undefined; i++) {
        try {
          ({ id } = (await Effect.runPromise(
            padi.lifecycle.create({
              placement: TOPLEVEL_PLACEMENT,
              cwd: makeStateRoot(),
            }),
          )) as { id: string });
        } catch {
          await sleep(100);
        }
      }
      if (id === undefined)
        throw new Error("re-served lifecycle.create never bound");
    }

    const confPath = join(stateRoot, "config.json");
    const savedLen = (): number | null => {
      try {
        return (
          (
            JSON.parse(readFileSync(confPath, "utf8")) as {
              session?: { terminals?: unknown[] };
            }
          ).session?.terminals?.length ?? 0
        );
      } catch {
        return null;
      }
    };
    let before = 0;
    for (let i = 0; i < 200 && before < 2; i++) {
      before = savedLen() ?? 0;
      if (before < 2) await sleep(100);
    }
    expect(before).toBeGreaterThanOrEqual(2);

    await session.renew();

    let minAfter = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 30; i++) {
      const s = savedLen();
      if (s !== null) minAfter = Math.min(minAfter, s);
      await sleep(50);
    }
    expect(minAfter).toBeGreaterThanOrEqual(before);
  }, 90000);

  it("a NEWER binder DRAINS a running older padi + respawns: padi gate pid CHANGES, the surviving kaval is re-adopted (pid UNCHANGED), the session is intact (newest-wins convergence)", async () => {
    const stateRoot = makeStateRoot();
    const first = await bootReServedPadi(stateRoot);

    let id: string | undefined;
    for (let i = 0; i < 200 && id === undefined; i++) {
      try {
        ({ id } = (await Effect.runPromise(
          first.padi.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: makeStateRoot(),
          }),
        )) as { id: string });
      } catch {
        await sleep(100);
      }
    }
    if (id === undefined)
      throw new Error("re-served lifecycle.create never bound");

    const kavalGate = join(
      dirname(padiKavalSocketPath(stateRoot)),
      "kaval.pid",
    );
    const padiPidBefore = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    const kavalPidBefore = gatePid(kavalGate);
    expect(padiPidBefore).toBeDefined();
    expect(kavalPidBefore).toBeDefined();

    const confPath = join(stateRoot, "config.json");
    const savedLen = (): number | null => {
      try {
        return (
          (
            JSON.parse(readFileSync(confPath, "utf8")) as {
              session?: { terminals?: unknown[] };
            }
          ).session?.terminals?.length ?? 0
        );
      } catch {
        return null;
      }
    };
    let before = 0;
    for (let i = 0; i < 200 && before < 1; i++) {
      before = savedLen() ?? 0;
      if (before < 1) await sleep(100);
    }
    expect(before).toBeGreaterThanOrEqual(1);

    first.session.destroy();
    await sleep(400);
    const isAlive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(isAlive(padiPidBefore as number)).toBe(true);

    const socketPath = padiSocketPath(stateRoot);
    const probe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: PADI_DRAIN_TEARDOWN_CEILING_MS,
    });
    const preProbe = await Effect.runPromise(probe(socketPath));
    expect(preProbe).not.toBeNull();
    expect(preProbe?.identity.contractVersion).toBe(PADI_SURFACE_VERSION);
    preProbe?.dispose();

    const [maj, min] = PADI_SURFACE_VERSION.split(".");
    const newerBinderVersion = `${maj}.${Number(min) + 1}`;

    const newerPolicy = {
      ...padiConvergencePolicy(""),
      baked: {
        contractVersion: newerBinderVersion,
        build: daemonBuild(""),
      },
    };
    const ep = createEndpoint({
      hostId: PADI_HOST_ID,
      home: {
        dir: dirname(socketPath),
        gatePath: padiGatePath(socketPath),
        socketPath,
      },
      policy: newerPolicy,
      probe,
      driver: localPadiDriver({
        stateRoot,
        socket: resolvedPadiSocket({ socketPath }),
        nixShellWhitelist: "default",
        verbose: false,
      }),
      connect: (path) => connectPadi(path),
      log: silentLog,
      onStatus: () => {},
    });
    await Effect.runPromise(converge(ep));

    const padiPidAfter = gatePid(padiGatePath(padiSocketPath(stateRoot)));
    expect(padiPidAfter).toBeDefined();
    expect(padiPidAfter).not.toBe(padiPidBefore);
    expect(isAlive(padiPidBefore as number)).toBe(false);

    const kavalPidAfter = gatePid(kavalGate);
    expect(kavalPidAfter).toBe(kavalPidBefore);

    let minAfter = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 40; i++) {
      const s = savedLen();
      if (s !== null) minAfter = Math.min(minAfter, s);
      await sleep(50);
    }
    expect(minAfter).toBeGreaterThanOrEqual(before);

    ep.current()?.dispose();
  }, 90000);
});

describe("localPadiDriver — the A8 runtime spawn leash at the real funnel (F5)", () => {
  const savedGate = process.env.KOLU_DAEMON_TESTS;
  afterEach(() => {
    if (savedGate === undefined) delete process.env.KOLU_DAEMON_TESTS;
    else process.env.KOLU_DAEMON_TESTS = savedGate;
  });

  it("REFUSES to spawn a real padi in a gate-off vitest worker (helper indirection can't smuggle a fork)", () => {
    delete process.env.KOLU_DAEMON_TESTS;
    const driver = localPadiDriver({
      stateRoot: "/tmp/kolu-f5-state",
      socket: resolvedPadiSocket({
        socketPath: "/run/user/1000/padi-x/padi.sock",
      }),
      verbose: false,
    });
    expect(() => Effect.runSync(driver.spawn)).toThrow(/KOLU_DAEMON_TESTS/);
  });
});

describe("local arm adopted-stale via convergence() (UW1 done-when / F9)", () => {
  it("ensurePadiBindingWith pin → drain not-taken → session.convergence() adopted-stale", async () => {
    const stateRoot = makeStateRoot();
    activeStateRoots.add(stateRoot);
    const home = padiRuntimeHome(stateRoot, residentPadiSocket(stateRoot));
    mkdirSync(home.dir, { recursive: true, mode: 0o700 });
    const gateFd = openSync(
      home.gatePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(gateFd, `${process.pid}\n`);
    } finally {
      closeSync(gateFd);
    }
    const sockServer = createServer((c) => c.on("error", () => {}));
    await new Promise<void>((resolve, reject) => {
      sockServer.once("error", reject);
      sockServer.listen(home.socketPath, () => resolve());
    });

    try {
      const binderBuildId = "binder-build-hex-f9";
      const staleBuild = "stale-running-build-f9";
      const policy = {
        ...padiConvergencePolicy(binderBuildId),
        drainBudget: { maxAttempts: 1, onGiveUp: "adopt-stale" as const },
      };

      const fakeClient = {
        surface: {
          control: {
            core: {
              hello: async () => ({
                stateRoot,
                surfaceVersion: PADI_SURFACE_VERSION,
                controlCoreVersion: "1.0",
                startedAt: 99,
                commit: "deadbee",
                buildId: staleBuild,
              }),
              drain: async () => {},
            },
          },
          padi: {
            system: {
              identity: async () => ({
                kind: "identified" as const,
                baked: {
                  contractVersion: PADI_SURFACE_VERSION,
                  commit: { kind: "commit" as const, sha: "deadbee" },
                },
                startedAt: 99,
              }),
              clockNow: async () => ({ epochMs: Date.now() }),
            },
          },
        },
      };

      let drainCalls = 0;
      let probeCalls = 0;
      const session = ensurePadiBindingWith(
        { stateRoot, reconnectDelayMs: 10_000 },
        {
          policy,
          probe: () =>
            Effect.sync(() => {
              probeCalls += 1;
              return {
                capability: "drainable" as const,
                identity: {
                  contractVersion: PADI_SURFACE_VERSION,
                  build: daemonBuild(staleBuild),
                },
                instanceKey: { kind: "instance" as const, key: 99 },
                fireDrain: Effect.sync(() => {
                  drainCalls += 1;
                }),
                awaitExit: Effect.never,
                drainCeilingMs: 30,
                dispose: () => {},
              };
            }),
          driver: () => ({ spawn: Effect.void }),
          connect: () =>
            Effect.succeed({
              // biome-ignore lint/suspicious/noExplicitAny: fake PadiDaemonClient for seam
              client: fakeClient as any,
              identity: {
                surfaceVersion: PADI_SURFACE_VERSION,
                buildId: staleBuild,
                startedAt: 99,
              },
              startedAt: 99,
              metadata: {
                contractVersion: PADI_SURFACE_VERSION,
                buildId: staleBuild,
              },
              dispose: () => {},
              onClose: () => {},
              // biome-ignore lint/suspicious/noExplicitAny: fake DaemonConnection for seam
            }) as any,
        },
      );
      activeSessions.push(session);

      await session.pin();

      expect(probeCalls).toBeGreaterThanOrEqual(1);
      expect(drainCalls).toBeGreaterThanOrEqual(1);

      expect(session.convergence()).not.toBeNull();
      expect(session.convergence()).toMatchObject({
        kind: "adopted-stale",
        running: {
          contractVersion: PADI_SURFACE_VERSION,
          build: { kind: "known", id: staleBuild },
        },
        expected: {
          build: { kind: "known", id: binderBuildId },
        },
      });
    } finally {
      sockServer.close();
      rmSync(home.gatePath, { force: true });
    }
  });
});

describe("ensurePadiBinding — the LOCAL arm's members before any connect (pure, no real padi)", () => {
  const build = (): PadiSession =>
    ensurePadiBinding({ stateRoot: makeStateRoot(), reconnectDelayMs: 10_000 });

  it("surfaces no convergence anomaly before any dial (standing anomaly is set by converge)", () => {
    const s = build();
    expect(s.convergence()).toBeNull();
    s.destroy();
  });

  it("identity() is the honest `disconnected` arm before any connect (never a fake 0)", () => {
    const s = build();
    expect(s.identity()).toEqual({ kind: "disconnected" });
    s.destroy();
    expect(s.identity()).toEqual({ kind: "disconnected" });
  });

  it("renew() (the restart/drain verb) throws LOUDLY when no padi is bound — never a phantom success", async () => {
    const s = build();
    await expect(Effect.runPromise(s.renew())).rejects.toThrow(
      /not bound|down|cannot drain/i,
    );
    s.destroy();
  });

  it("declares its preservation (padi's PTYs SURVIVE a renew — they live in kaval)", () => {
    const s = build();
    expect(s.preservation).toEqual({ children: "survive" });
    s.destroy();
  });
});

describe("resolvePadiLaunch — the legacy-kaval-socket adopt-hint (binder hints its OWN port)", () => {
  const stateRoot = "/state/root";
  const socketPath = "/run/user/1000/padi-deadbeef/padi.sock";
  const BUILT: PadiLaunchMode = { kind: "systemd", binPath: "/nix/store/padi" };
  const launch = (legacyKavalSocket: string | undefined) => ({
    stateRoot,
    socket: resolvedPadiSocket({ socketPath }),
    legacyKavalSocket,
    verbose: false,
  });

  it("forwards `--legacy-kaval-socket <path>` VERBATIM when the binder hints one (its own listen port's legacy socket)", () => {
    const hint = "/run/user/1000/kaval-7681/pty-host.sock";
    const { args } = resolvePadiLaunch(launch(hint), BUILT);
    const i = args.indexOf("--legacy-kaval-socket");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(hint);
  });

  it("OMITS the flag entirely for a standalone bring-up (no hint) — so a padi with no binder never adopts a stray port kaval", () => {
    const { args } = resolvePadiLaunch(launch(undefined), BUILT);
    expect(args).not.toContain("--legacy-kaval-socket");
  });
});

describe("daemonEnv — the server → padi forwarding hop for the run-bind pid", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forwards the run-bind pid VERBATIM into padi's env when the server carries one", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, "4321");
    expect(daemonEnv("/state/root", false)[DAEMON_BIND_PID_ENV]).toBe("4321");
  });

  it("OMITS the var when the server's is truly unset (production padi stays `forever`)", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, undefined);
    expect(daemonEnv("/state/root", false)).not.toHaveProperty(
      DAEMON_BIND_PID_ENV,
    );
  });

  it("forwards even an empty value (broken expansion) so padi fail-fasts, never drops it back to `forever`", () => {
    vi.stubEnv(DAEMON_BIND_PID_ENV, "");
    expect(daemonEnv("/state/root", false)[DAEMON_BIND_PID_ENV]).toBe("");
  });

  it("forwards the agent toolchain bake to the padi kolu spawns", () => {
    vi.stubEnv(AGENT_TOOLS_BAKE_ENV, "/nix/store/bbb-tools/bin");
    expect(daemonEnv("/state/root", false)[AGENT_TOOLS_BAKE_ENV]).toBe(
      "/nix/store/bbb-tools/bin",
    );
  });

  it("a from-source kolu has no bake to forward (no build skew by the back door)", () => {
    vi.stubEnv(AGENT_TOOLS_BAKE_ENV, undefined);
    vi.stubEnv(TERMINAL_TOOLS_PATH_ENV, "/nix/store/OUTER-build-tools/bin");
    const env = daemonEnv("/state/root", false);
    expect(env).not.toHaveProperty(AGENT_TOOLS_BAKE_ENV);
    expect(env).not.toHaveProperty(TERMINAL_TOOLS_PATH_ENV);
  });

  it.each([
    ["KAVAL_BUILD_ID", "build-only"],
    ["KAVAL_COMMIT_HASH", "commit-only"],
  ])("rejects a half-baked kaval identity at the binder (%s only)", (name, value) => {
    vi.stubEnv("KAVAL_BUILD_ID", undefined);
    vi.stubEnv("KAVAL_COMMIT_HASH", undefined);
    vi.stubEnv(name, value);

    expect(() => daemonEnv("/state/root", false)).toThrow(
      "incomplete baked identity: KAVAL_BUILD_ID and KAVAL_COMMIT_HASH must be set together",
    );
  });

  it("is EXACTLY every allowlist key + every padi-operational input — no dropped base key, no leaked ambient key (#1872 2a parity)", () => {
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) delete process.env[k];
      const expected: Record<string, string> = {};
      for (const k of SPAWN_ENV_ALLOWLIST) {
        process.env[k] = `val-${k}`;
        expected[k] = `val-${k}`;
      }
      process.env.KOLU_STATE_DIR = "/state";
      process.env.KOLU_KAVAL_SPAWN = "detached";
      process.env.LOG_LEVEL = "warn";
      process.env.NODE_OPTIONS = "--max-old-space-size=4096";
      process.env.KOLU_DIAG_DIR = "/diag";
      process.env.KAVAL_BUILD_ID = "bid";
      process.env.KAVAL_COMMIT_HASH = "hash";
      process.env[DAEMON_BIND_PID_ENV] = "4321";
      for (const k of AGENT_DIR_ENV_KEYS) {
        process.env[k] = `dir-${k}`;
        expected[k] = `dir-${k}`;
      }
      process.env.CLAUDE_CODE_CHILD_SESSION = "1";
      Object.assign(expected, {
        KOLU_STATE_DIR: "/state",
        KOLU_PADI_STATE_DIR: "/state/root",
        KOLU_KAVAL_SPAWN: "detached",
        LOG_LEVEL: "warn",
        NODE_OPTIONS: "--max-old-space-size=4096",
        KOLU_DIAG_DIR: "/diag",
        KAVAL_BUILD_ID: "bid",
        KAVAL_COMMIT_HASH: "hash",
        [DAEMON_BIND_PID_ENV]: "4321",
      });

      expect(daemonEnv("/state/root", false)).toEqual(expected);
    } finally {
      for (const k of Object.keys(process.env)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("resolvePadiLaunch — the from-source entrypoint (KOLU_PADI_BIN unset) resolves to a REAL file", () => {
  const stateRoot = "/state/root";

  it("points at packages/padi/src/daemonBoot/bin.ts, an existing file — not a phantom under packages/server/ (L27 move must not skew the ../.. hop)", () => {
    const prev = process.env.KOLU_PADI_BIN;
    delete process.env.KOLU_PADI_BIN;
    try {
      const mode = padiLaunchMode();
      expect(mode).toEqual({ kind: "detached-from-source" });
      const { binPath, args } = resolvePadiLaunch(
        {
          stateRoot,
          socket: resolvedPadiSocket({
            socketPath: padiSocketPath(stateRoot),
          }),
          verbose: false,
        },
        mode,
      );
      expect(binPath).toBe(process.execPath);
      const importIdx = args.indexOf("--import");
      expect(importIdx).toBeGreaterThanOrEqual(0);
      const binTs = args[importIdx + 2];
      if (binTs === undefined)
        throw new Error("expected --import to be followed by a bin.ts path");
      expect(binTs.endsWith("packages/padi/src/daemonBoot/bin.ts")).toBe(true);
      expect(existsSync(binTs)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.KOLU_PADI_BIN;
      else process.env.KOLU_PADI_BIN = prev;
    }
  });
});

describe("resolvePadiLaunch — single-source the padi socket path (#1713 pattern)", () => {
  const stateRoot = "/state/root";
  const BUILT: PadiLaunchMode = { kind: "systemd", binPath: "/nix/store/padi" };

  it("ALWAYS forwards `--socket <path>` VERBATIM — the exact path the binder already computed with padiSocketPath, so padi's own process never re-derives it from its own env", () => {
    const socketPath = padiSocketPath(stateRoot);
    const { args } = resolvePadiLaunch(
      {
        stateRoot,
        socket: resolvedPadiSocket({ socketPath }),
        verbose: false,
      },
      BUILT,
    );
    const i = args.indexOf("--socket");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe(socketPath);
  });

  it("wait-path === serve-path EVEN WHEN the two sides read $XDG_RUNTIME_DIR at genuinely different moments (SET at wait-time, UNSET at serve-time, and vice versa) — the real shape of the bug, where a transient systemd-run unit's own default env can differ from the binder's. Without the fix, padi's own `padiSocketPath(stateRoot, opts.socketOverride)` (daemonMain.ts) would re-read its OWN env and diverge from what the binder dials; with the fix the override makes the serve side ignore its env entirely", () => {
    const prevXdg = process.env.XDG_RUNTIME_DIR;
    try {
      for (const [waitXdg, serveXdg] of [
        ["/run/user/1000", undefined],
        [undefined, "/run/user/1000"],
        [undefined, undefined],
        ["/run/user/1000", "/run/user/1000"],
      ] as const) {
        setXdgRuntimeDir(waitXdg);
        const waitPath = padiSocketPath(stateRoot);
        const { args } = resolvePadiLaunch(
          {
            stateRoot,
            socket: resolvedPadiSocket({ socketPath: waitPath }),
            verbose: false,
          },
          BUILT,
        );
        const socketOverride = args[args.indexOf("--socket") + 1];

        setXdgRuntimeDir(serveXdg);
        const servePath = padiSocketPath(stateRoot, socketOverride);

        expect(servePath).toBe(waitPath);
      }
    } finally {
      setXdgRuntimeDir(prevXdg);
    }
  });
});

describe("padiConnectFailure — the ONE fatal classification (#1313 adoption-refused vs. everything-else-retries)", () => {
  const stateRoot = "/state/root";
  const socketPath = "/run/user/1000/padi-deadbeef/padi.sock";

  it("a genuine skew-refused outcome (never adopted) is FATAL — a PadiAdoptionRefusedError naming the state dir + socket + remedy", () => {
    const outcome: ConvergenceOutcome = {
      kind: "refused",
      adopted: false,
      anomaly: {
        kind: "skew-refused",
        running: {
          contractVersion: "9.0",
          build: daemonBuild("x"),
        },
        expected: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild("mine"),
        },
        detail: "skew",
      },
    };
    const err = padiConnectFailure(outcome, stateRoot, socketPath);
    expect(err).toBeInstanceOf(PadiAdoptionRefusedError);
    expect(err.message).toContain(stateRoot);
    expect(err.message).toContain(socketPath);
    expect(err.message).toContain("KOLU_STATE_DIR");
  });

  it("cross-supervisor refuse is a ConnectError naming the fight — not a contract-skew refusal", () => {
    const err = padiConnectFailure(
      {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "cross-supervisor",
          drained: { kind: "instance", key: 1 },
          observed: { kind: "instance", key: 2 },
          running: {
            contractVersion: PADI_SURFACE_VERSION,
            build: daemonBuild("x"),
          },
          detail: "foreign instance of drained build",
        },
      },
      stateRoot,
      socketPath,
    );
    expect(err).toBeInstanceOf(ConnectError);
    expect(err).not.toBeInstanceOf(PadiAdoptionRefusedError);
    expect(err.message).toMatch(/cross-supervisor/i);
  });

  it("every other reason `conn` is undefined stays the pre-existing retryable ConnectError — never fatal", () => {
    const outcomes: ConvergenceOutcome[] = [
      { kind: "not-adopted" },
      { kind: "recycled", bind: { kind: "refused-or-failed" } },
      {
        kind: "drained-replacing",
        axis: "build",
        running: {
          contractVersion: PADI_SURFACE_VERSION,
          build: daemonBuild(""),
        },
        bind: { kind: "refused-or-failed" },
      },
    ];
    for (const outcome of outcomes) {
      const err = padiConnectFailure(outcome, stateRoot, socketPath);
      expect(err).toBeInstanceOf(ConnectError);
      expect(err).not.toBeInstanceOf(PadiAdoptionRefusedError);
    }
  });
});

describe("reportFatalBindingError — a refusal reported on EVERY dial, not just the first (delta-re-review finding 2)", () => {
  it("invokes the hook for a genuine PadiAdoptionRefusedError", () => {
    const err = new PadiAdoptionRefusedError(
      "a padi is already serving this workspace",
    );
    const seen: PadiAdoptionRefusedError[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([err]);
  });

  it("does NOT invoke the hook for a non-fatal (retryable) classification", () => {
    const err = new ConnectError("padi did not come up", "network");
    const seen: unknown[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([]);
  });

  it("is a no-op when no hook is supplied (the option is optional)", () => {
    expect(() =>
      reportFatalBindingError(new PadiAdoptionRefusedError("x"), undefined),
    ).not.toThrow();
  });

  it("invokes the hook for a PadiStateRootGoneError too — the #2010 gone-root verdict is the same fatal class", () => {
    const err = new PadiStateRootGoneError("/gone/worktree/.kolu-dev/padi");
    const seen: unknown[] = [];
    reportFatalBindingError(err, (e) => seen.push(e));
    expect(seen).toEqual([err]);
  });

  it("PIN: a refuse reached on a SIMULATED RECONNECT dial (a second, later call) still reports — never silently swallowed", () => {
    const seen: PadiAdoptionRefusedError[] = [];
    const onFatalBindingError = (e: PadiAdoptionRefusedError): void => {
      seen.push(e);
    };

    reportFatalBindingError(
      padiConnectFailure({ kind: "not-adopted" }, "/sr", "/sock"),
      onFatalBindingError,
    );
    expect(seen).toHaveLength(0);

    const err = padiConnectFailure(
      {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "skew-refused",
          running: {
            contractVersion: "9.0",
            build: daemonBuild(""),
          },
          expected: {
            contractVersion: PADI_SURFACE_VERSION,
            build: daemonBuild("mine"),
          },
          detail: "skew",
        },
      },
      "/sr",
      "/sock",
    );
    reportFatalBindingError(err, onFatalBindingError);
    expect(seen).toEqual([err]);
  });
});

describe("handlePadiBootFailure — the composition root's boot-pin catch (exits ONLY on the fatal classification)", () => {
  it("a PadiAdoptionRefusedError logs FATAL and exits non-zero, naming the conflict + remedy", () => {
    const err = new PadiAdoptionRefusedError(
      "a padi is already serving this workspace — state dir /x, socket /y. " +
        "run with KOLU_STATE_DIR=<dir> for a second instance.",
    );
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(err, {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]?.[1]).toContain("KOLU_STATE_DIR");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("a PadiStateRootGoneError (#2010) logs FATAL and exits non-zero — a deleted workspace is terminal, never a retry", () => {
    const err = new PadiStateRootGoneError("/gone/worktree/.kolu-dev/padi");
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(err, {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(fatal.mock.calls[0]?.[1]).toContain("/gone/worktree/.kolu-dev/padi");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("every other error (transient boot hiccup) logs error and does NOT exit — the fail-open stance", () => {
    const fatal = vi.fn();
    const error = vi.fn();
    const exit = vi.fn();
    handlePadiBootFailure(new ConnectError("padi did not come up", "network"), {
      log: { fatal, error },
      exit: exit as unknown as (code: number) => void,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("ensurePadiBinding — the #2010 gone-root gate (fork-free: the gate throws before any converge/spawn)", () => {
  it("creates a missing state root at boot; a dial after its deletion reports PadiStateRootGoneError — never a respawn", async () => {
    const parent = mkdtempSync(join(tmpdir(), "padi-goneroot-"));
    const stateRoot = join(parent, "nested", "padi-state");
    const seen: unknown[] = [];
    let firstVerdict!: (e: unknown) => void;
    const verdictP = new Promise<unknown>((r) => {
      firstVerdict = r;
    });
    let session: PadiSession | undefined;
    try {
      session = ensurePadiBinding({
        stateRoot,
        nixShellWhitelist: "default",
        reconnectDelayMs: 50,
        onFatalBindingError: (e) => {
          seen.push(e);
          firstVerdict(e);
        },
      });
      expect(existsSync(stateRoot)).toBe(true);
      rmSync(parent, { recursive: true, force: true });
      const pinP = session.pin();
      pinP.catch(() => {});
      const err = await verdictP;
      expect(err).toBeInstanceOf(PadiStateRootGoneError);
      expect((err as Error).message).toContain(stateRoot);
      await expect(pinP).rejects.toBeInstanceOf(PadiStateRootGoneError);
    } finally {
      session?.destroy();
      rmSync(parent, { recursive: true, force: true });
    }
  }, 15000);
});

describeDaemon(
  "ensurePadiBinding — ADOPTS a resident registered under a MISMATCHED drawer (#1713 adopt-path sibling, the live repro)",
  () => {
    it("a waiter whose own env computes a different drawer than a real resident still ADOPTS it — fast, no redundant spawn", async () => {
      const stateRoot = makeStateRoot();
      const waiterDrawer = mkdtempSync(
        join(tmpdir(), "padi-bind-waiter-drawer-"),
      );
      const savedXdg = process.env.XDG_RUNTIME_DIR;
      let residentSession: PadiSession | undefined;
      let waiterSession: PadiSession | undefined;
      try {
        delete process.env.XDG_RUNTIME_DIR;
        residentSession = ensurePadiBinding({
          stateRoot,
          nixShellWhitelist: "default",
          reconnectDelayMs: 400,
        });
        // biome-ignore lint/suspicious/noExplicitAny: the raw session client is walked structurally, like `roundTripTerminal`'s `padi`.
        const residentClient: any = await residentSession.pin();
        const residentPid = gatePid(padiGatePath(padiSocketPath(stateRoot)));
        expect(residentPid).toBeDefined();

        const { id } = (await Effect.runPromise(
          residentClient.surface.lifecycle.create({
            placement: TOPLEVEL_PLACEMENT,
            cwd: makeStateRoot(),
          }),
        )) as { id: string };
        expect(id).toMatch(/^[0-9a-f-]{36}$/);

        process.env.XDG_RUNTIME_DIR = waiterDrawer;
        waiterSession = ensurePadiBinding({
          stateRoot,
          nixShellWhitelist: "default",
          reconnectDelayMs: 400,
        });
        const startedAt = Date.now();
        // biome-ignore lint/suspicious/noExplicitAny: see `residentClient` above.
        const waiterClient: any = await waiterSession.pin();
        const elapsedMs = Date.now() - startedAt;

        expect(elapsedMs).toBeLessThan(10_000);

        const screen = await Effect.runPromise(
          waiterClient.surface.screen.state({ id }),
        );
        expect(typeof screen).toBe("string");

        expect(
          gatePid(padiGatePath(padiSocketPath(stateRoot))),
        ).toBeUndefined();

        delete process.env.XDG_RUNTIME_DIR;
        expect(gatePid(padiGatePath(padiSocketPath(stateRoot)))).toBe(
          residentPid,
        );
      } finally {
        waiterSession?.destroy();
        residentSession?.destroy();
        delete process.env.XDG_RUNTIME_DIR;
        reap(stateRoot);
        await sleep(50);
        rmSync(dirname(padiSocketPath(stateRoot)), {
          recursive: true,
          force: true,
        });
        rmSync(dirname(padiKavalSocketPath(stateRoot)), {
          recursive: true,
          force: true,
        });
        rmSync(waiterDrawer, { recursive: true, force: true });
        if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
        else process.env.XDG_RUNTIME_DIR = savedXdg;
      }
    }, 60000);
  },
);
