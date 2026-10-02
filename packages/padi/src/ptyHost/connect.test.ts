/**
 * `connectKaval` + `probeKavalForConvergence` over the REAL wire.
 *
 * Two things are pinned here, and only the second one moved with PLAN D6:
 *
 *   1. **The handshake middle-hop (F6).** `connectKaval` reads `system.version`
 *      off a live kaval and copies its OPTIONAL `lifetime` onto the connection
 *      `metadata`. Because `KavalConnectionMetadata.lifetime` is optional (a
 *      survivor predating the field reports none), deleting that copy still
 *      type-checks — so the passthrough needs a behavioural pin. This dials a
 *      REAL kaval over a REAL unix socket, the exact `dialSocket` + `stdioLink`
 *      path production uses.
 *
 *   2. **Partial peers.** The old file's "pre-fragment daemon" fixtures were an
 *      oRPC router carrying a hand-copied contract entry, and the tolerance
 *      branches they exercised are GONE: a kaval that predates the frozen
 *      control core also predates this protocol epoch, so its first frame is
 *      undecodable and a dial never reaches route resolution at all (that peer
 *      is the supervisor's `unspeakable-protocol` observation, not this
 *      module's business). What remains real, and is pinned instead, is the
 *      IN-EPOCH partial peer: a daemon that speaks this exact protocol and
 *      serves a NARROWER member set, or reports a `contractVersion` we refuse.
 *      Its fake takes the LIVE `Rpc` out of `kavalDaemonGroup` — kaval's
 *      `contractSkew.test.ts` model — so a fake can never drift from the
 *      surface it imitates.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { controlCoreFragment, controlCoreSurface } from "@kolu/surface-daemon";
import {
  implementSurfaces,
  type SurfaceHandler,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import {
  type PtyHostSocketListener,
  PTY_HOST_CONTRACT_VERSION,
  createInProcessPtyHost,
  kavalDaemonGroup,
  serveKavalDaemonSurface,
  servePtyHostOverUnixSocket,
} from "kaval";
import {
  converge,
  isSocketSquatterForeignError,
  instanceKeyFromStartedAt,
  isUnspeakableProtocolError,
} from "@kolu/surface-daemon-supervisor";
import { createEndpointForKoluTest } from "@kolu/surface-daemon-supervisor/createEndpoint.kolu.testlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectKaval,
  isNoListenerError,
  probeKavalForConvergence,
} from "./connect.ts";
import { probeKavalStatus } from "../hostInventory.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";

const VERSION_TAG = "surface/system/version";
const LIST_TAG = "surface/terminal/list";
const HELLO_TAG = "surface/control/core/hello";

/** Serve a daemon assembled from LIVE `Rpc`s taken out of `kavalDaemonGroup`,
 *  answering only the tags named here. Every other tag is simply not served —
 *  which is exactly how a peer with a narrower member set presents to us. */
async function serveFake(
  socketPath: string,
  byTag: Record<string, SurfaceHandler>,
): Promise<UnixSocketListener> {
  const handlers: SurfaceHandlers = Object.create(null);
  const rpcs = Object.entries(byTag).map(([tag, handler]) => {
    const rpc = kavalDaemonGroup.requests.get(tag);
    if (rpc === undefined) {
      throw new Error(`${tag} is not on the kaval daemon surface`);
    }
    handlers[tag] = handler;
    return rpc;
  });
  const listener = await serveOverUnixSocket({
    socketPath,
    group: RpcGroup.make(...rpcs),
    handlers,
    log: silentLog,
  });
  expect(listener.outcome).toEqual({ kind: "listening" });
  return listener;
}

function sockPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "pty-host.sock");
}

/** Serve a kaval whose resolved lifetime is `boundToPid` (the CI/smoke policy),
 *  so a copy of the value can be distinguished from the production `forever`. */
function makePtyHost() {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-connect-rc-")),
    lifetime: { kind: "boundToPid", pid: 4242 },
  });
}

async function serveCurrent(
  socketPath: string,
  opts: {
    controlStartedAtOffset?: number;
    controlIdentity?: { staleKey: string; navigableCommit: string };
  } = {},
) {
  const savedBuildId = process.env.KAVAL_BUILD_ID;
  const savedCommit = process.env.KAVAL_COMMIT_HASH;
  process.env.KAVAL_BUILD_ID = "fragment-build";
  process.env.KAVAL_COMMIT_HASH = "fragment-commit";
  let ptyHost: ReturnType<typeof makePtyHost>;
  try {
    ptyHost = makePtyHost();
  } finally {
    if (savedBuildId === undefined) delete process.env.KAVAL_BUILD_ID;
    else process.env.KAVAL_BUILD_ID = savedBuildId;
    if (savedCommit === undefined) delete process.env.KAVAL_COMMIT_HASH;
    else process.env.KAVAL_COMMIT_HASH = savedCommit;
  }
  const controlPtyHost =
    opts.controlStartedAtOffset || opts.controlIdentity
      ? {
          ...ptyHost,
          boot: Object.freeze({
            ...ptyHost.boot,
            startedAt:
              ptyHost.boot.startedAt + (opts.controlStartedAtOffset ?? 0),
            identity: opts.controlIdentity ?? ptyHost.boot.identity,
          }),
        }
      : ptyHost;
  const runtime = serveKavalDaemonSurface({
    ptyHost: controlPtyHost,
    stateRoot: "/run/kaval-current",
  });
  const listener: PtyHostSocketListener = await servePtyHostOverUnixSocket({
    socketPath,
    served: { group: runtime.group, handlers: runtime.handlers },
    log: silentLog,
  });
  return {
    socketPath,
    close: async () => {
      listener.close();
      await runtime.close();
    },
  };
}

/** Serve ONLY the frozen fragment. A probe that regresses to system.version
 * cannot pass this fixture because that route does not exist. */
async function serveFrozenIdentity(socketPath: string) {
  const runtime = implementSurfaces(
    { control: controlCoreSurface },
    {},
    {
      control: controlCoreFragment({
        stateRoot: "/run/kaval-probe",
        surfaceVersion: "5.3",
        startedAt: 777,
        commit: "fragment-commit",
        buildId: "fragment-build",
        onDrain: () => {
          throw new Error("not used by a not-drainable probe");
        },
      }),
    },
  );
  const listener = await serveOverUnixSocket({
    socketPath,
    group: runtime.group,
    handlers: runtime.handlers,
    log: silentLog,
  });
  return {
    socketPath,
    close: async () => {
      listener.close();
      await runtime.close();
    },
  };
}

describe("connectKaval — mirrors the handshake lifetime onto the metadata", () => {
  let listener: Awaited<ReturnType<typeof serveCurrent>>;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = sockPath("kolu-connect-sock-");
    listener = await serveCurrent(socketPath);
  });

  afterAll(async () => await listener.close());

  it("carries the served lifetime through to metadata.lifetime", async () => {
    const conn = await Effect.runPromise(connectKaval(socketPath));
    try {
      // The whole point of F6: this fails (undefined) if the `lifetime:
      // version.lifetime` copy in connect.ts is dropped, even though the type
      // stays green because the field is optional.
      expect(conn.metadata.lifetime).toEqual({ kind: "boundToPid", pid: 4242 });
      expect(conn.metadata.contractVersion).toBeTypeOf("string");
      expect(conn.metadata.pid).toBe(process.pid);
      expect(conn.identity).toEqual({
        staleKey: "fragment-build",
        navigableCommit: "fragment-commit",
      });
      await expect(
        Effect.runPromise(probeKavalStatus(socketPath)),
      ).resolves.toMatchObject({
        buildCommit: "fragment-commit",
      });
    } finally {
      conn.dispose();
    }
  });
});

describe("connectKaval — identity comes only from frozen hello", () => {
  it("REFUSES a peer that speaks this protocol but serves no frozen control core", async () => {
    // The in-epoch successor of the retired pre-fragment tolerance. Such a peer
    // is REACHABLE (its framing decodes, its `system.version` answers), so the
    // refusal has to come from the handshake rather than from the transport —
    // and it must be LOUD, because within this epoch a kaval without the frozen
    // core is broken, not merely old.
    const socketPath = sockPath("kolu-connect-no-core-");
    const listener = await serveFake(socketPath, {
      [VERSION_TAG]: () =>
        Effect.succeed({
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          pid: process.pid,
          startedAt: 424_242,
        }),
      [LIST_TAG]: () => Effect.succeed({ entries: [] }),
    });
    try {
      await expect(Effect.runPromise(connectKaval(socketPath))).rejects.toThrow(
        /pty-host handshake failed — could not read control\.core\.hello/,
      );
    } finally {
      listener.close();
    }
  });

  it("rejects a current daemon whose two handshake surfaces name different boots", async () => {
    const socketPath = sockPath("kolu-connect-split-boot-");
    const listener = await serveCurrent(socketPath, {
      controlStartedAtOffset: 1,
    });
    try {
      await expect(Effect.runPromise(connectKaval(socketPath))).rejects.toThrow(
        /pty-host handshake failed — control-core reports boot .* but system\.version reports/,
      );
    } finally {
      await listener.close();
    }
  });

  it("rejects a current kaval whose frozen identity is only half-present", async () => {
    const socketPath = sockPath("kolu-connect-partial-identity-");
    const listener = await serveCurrent(socketPath, {
      controlIdentity: {
        staleKey: "",
        navigableCommit: "fragment-commit",
      },
    });
    try {
      await expect(Effect.runPromise(connectKaval(socketPath))).rejects.toThrow(
        "incomplete control-core identity: buildId and commit must be both absent, both empty, or both non-empty",
      );
      await expect(
        Effect.runPromise(probeKavalStatus(socketPath)),
      ).rejects.toThrow(
        "incomplete control-core identity: buildId and commit must be both absent, both empty, or both non-empty",
      );
    } finally {
      await listener.close();
    }
  });
});

describe("connectKaval — the handshake read is bounded (F2)", () => {
  it("rejects a completely silent peer on keep-alive loss, then refuses the foreign socket holder", async () => {
    const socketPath = sockPath("kolu-completely-silent-");
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      // Consume requests and pings, but write NOTHING back (including no Pong).
      socket.resume();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    const failures: Error[] = [];
    const states: string[] = [];
    const spawn = vi.fn(() => {
      throw new Error("a foreign socket holder must never be replaced");
    });
    const endpoint = createEndpointForKoluTest({
      hostId: "local",
      home: {
        dir: dirname(socketPath),
        gatePath: join(dirname(socketPath), "kaval.pid"),
        socketPath,
      },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: PTY_HOST_CONTRACT_VERSION,
          build: { kind: "off-nix" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      // Enter the gate-less recovery path. Its OS holder lookup and every
      // connect attempt below are real; no fabricated transport error.
      probe: () => Effect.succeed(null),
      driver: { spawn: Effect.sync(spawn) },
      connect: (path) =>
        connectKaval(path).pipe(
          Effect.tapError((error) => Effect.sync(() => failures.push(error))),
        ),
      log: silentLog,
      onStatus: (_host, status) => states.push(status.state),
      adoptConnectAttempts: 1,
    });
    try {
      const result = await Effect.runPromise(Effect.result(converge(endpoint)));
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure")
        throw new Error("foreign peer was adopted");
      expect(isSocketSquatterForeignError(result.failure)).toBe(true);
      if (!isSocketSquatterForeignError(result.failure)) throw result.failure;
      expect(
        result.failure.holders.some((holder) => holder.pid === process.pid),
      ).toBe(true);
      // Three bounded recovery passes, each ending in Effect 4's keep-alive
      // refusal rather than the independent 30s frozen-hello deadline.
      expect(failures).toHaveLength(3);
      for (const error of failures) {
        expect(error.message).toBe(
          `pty-host handshake failed — could not read control.core.hello (surface stdio transport closed: unix socket ${socketPath}: the peer stopped answering the keep-alive ping)`,
        );
      }
      expect(states).toContain("dead");
      expect(spawn).not.toHaveBeenCalled();
      expect(server.listening).toBe(true);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(dirname(socketPath), { recursive: true });
    }
  }, 60_000);

  it("rejects on the baked deadline when a peer accepts the socket but never answers frozen hello", async () => {
    // Keep the transport healthy while the hello handler wedges. A completely
    // silent socket now loses Effect 4's keep-alive race before the 30s hello
    // deadline, so it cannot prove this independent bound on the RPC read.
    // Both the real transport and the baked deadline remain enabled.
    const socketPath = sockPath("kolu-hello-silent-");
    const listener = await serveFake(socketPath, {
      [HELLO_TAG]: () => Effect.never,
    });
    // Use real time: advancing fake timers by 30s starves socket IO and races
    // the heartbeat even though the real server is ready to answer pings.
    try {
      await expect(Effect.runPromise(connectKaval(socketPath))).rejects.toThrow(
        /control-core hello timed out after 30000ms/,
      );
    } finally {
      await listener.close();
    }
  }, 40_000);

  it("rejects on the 10s version deadline when the frozen hello answers but system.version never does", async () => {
    // The SECOND deadline, distinct from the supervisor-owned 30s frozen-hello
    // one: this daemon is reachable and identifies itself, then wedges on the
    // versioned read. Both deadlines are baked constants, never knobs.
    const socketPath = sockPath("kolu-version-silent-");
    const listener = await serveFake(socketPath, {
      [HELLO_TAG]: () =>
        Effect.succeed({
          stateRoot: "/run/kaval-wedged",
          surfaceVersion: PTY_HOST_CONTRACT_VERSION,
          controlCoreVersion: "1.0",
          startedAt: 424_242,
        }),
      [VERSION_TAG]: () => Effect.never,
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const outcome = Effect.runPromise(connectKaval(socketPath)).then(
        () => "resolved",
        (e: unknown) => (e as Error).message,
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(outcome).resolves.toMatch(
        /handshake read exceeded 10000ms deadline/,
      );
    } finally {
      vi.useRealTimers();
      listener.close();
    }
  });
});

describe("connectKaval — in-epoch contract skew is DATA, not a transport failure", () => {
  it("refuses a speakable peer whose contract version this build cannot accept", async () => {
    // The distinction D6 rests on: the link is fine, the frames decode, the
    // handshake reads — and the verdict is then computed from two strings. A
    // supervisor that could not tell this from a broken link could not tell a
    // wrong-version daemon (recycle it) from a foreign squatter (leave it).
    const socketPath = sockPath("kolu-connect-skew-");
    const listener = await serveFake(socketPath, {
      [HELLO_TAG]: () =>
        Effect.succeed({
          stateRoot: "/run/kaval-skewed",
          surfaceVersion: "1.0",
          controlCoreVersion: "1.0",
          startedAt: 424_242,
        }),
      [VERSION_TAG]: () =>
        Effect.succeed({
          contractVersion: "1.0",
          pid: process.pid,
          startedAt: 424_242,
        }),
    });
    try {
      await expect(
        Effect.runPromise(connectKaval(socketPath)),
      ).rejects.toMatchObject({
        daemonVersion: "1.0",
        requiredVersion: PTY_HOST_CONTRACT_VERSION,
      });
    } finally {
      listener.close();
    }
  });
});

/**
 * Production-path pins for `probeKavalForConvergence`.
 * Catch-to-null, a system.version regression, ECONNREFUSED arm deletion, and
 * no-op dispose must all stay mutation-red.
 */
describe("probeKavalForConvergence — frozen production path", () => {
  it("ENOENT (missing path) ⇒ null (honest absence)", async () => {
    const missing = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-absent-")),
      "no.sock",
    );
    await expect(
      Effect.runPromise(probeKavalForConvergence(missing)),
    ).resolves.toBeNull();
  });

  it("W8.2: isNoListenerError accepts both ECONNREFUSED and ENOENT (classifier pin)", () => {
    // Focused classifier pin: deleting either arm from isNoListenerError goes
    // red. The ENOENT production path is covered by the missing-path test
    // above; this pin holds the ECONNREFUSED arm that path never exercises.
    expect(isNoListenerError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isNoListenerError({ code: "ENOENT" })).toBe(true);
    expect(isNoListenerError({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    // Non-absence codes stay failures (must not collapse into null).
    expect(isNoListenerError({ code: "EPERM" })).toBe(false);
    expect(isNoListenerError(new Error("boom"))).toBe(false);
  });

  it("socket accepts but nothing ever answers ⇒ REJECTS (not null)", async () => {
    // Distinguishes catch-to-null (wave-6 regression) from honest absence:
    // resolving null here would mute the failure and adopt nothing as free.
    const socketPath = sockPath("kolu-probe-silent-");
    const server = createServer((sock) => {
      sock.on("error", () => {});
      // Read our frames, answer none of them — never `control.core.hello`.
      sock.resume();
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const outcome = Effect.runPromise(
        probeKavalForConvergence(socketPath),
      ).then(
        (v) => (v === null ? ("null" as const) : ("probe" as const)),
        (e: unknown) => e,
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      // Deliberately LESS than the frozen hello's 30 s deadline: a peer that
      // accepts and stays mute is classified at the dial's own silence bound
      // (D6/#9), so this probe must already have settled here. Before that
      // bound existed this same clock had to run all the way to 30 s.
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await outcome;
      // Must reject — never resolve null, never yield an identity.
      expect(result).not.toBe("null");
      expect(result).not.toBe("probe");
      expect(isUnspeakableProtocolError(result)).toBe(true);
      if (!isUnspeakableProtocolError(result)) throw new Error("unreachable");
      expect(result.evidence.trigger).toBe("silence");
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });

  it("fragment-only server ⇒ frozen identity + startedAt key + observed dispose", async () => {
    const socketPath = sockPath("kolu-probe-live-");
    const listener = await serveFrozenIdentity(socketPath);
    // Spy the production Socket.destroy boundary — a no-op dispose leaves this
    // call count unchanged and turns the test red (W8.2).
    const destroySpy = vi.spyOn(Socket.prototype, "destroy");
    try {
      const probe = await Effect.runPromise(
        probeKavalForConvergence(socketPath),
      );
      expect(probe).not.toBeNull();
      if (probe === null) {
        throw new Error("unreachable: probe null after expect");
      }
      expect(probe.capability).toBe("not-drainable");
      expect(probe.identity).toEqual({
        contractVersion: "5.3",
        build: { kind: "known", id: "fragment-build" },
      });
      expect(probe.instanceKey).toEqual(instanceKeyFromStartedAt(777));
      expect(probe.instanceKey.kind).toBe("instance");
      const destroysBefore = destroySpy.mock.calls.length;
      probe.dispose();
      // Observable transport close — not a vacuous "callable exists" check.
      expect(destroySpy.mock.calls.length).toBeGreaterThan(destroysBefore);
    } finally {
      destroySpy.mockRestore();
      await listener.close();
    }
  });
});
