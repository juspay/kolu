import { mkdtempSync, rmSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { setTimeout as breathe } from "node:timers/promises";
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
  it("rejects a completely silent peer at the frozen-hello deadline, then refuses the foreign socket holder", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
    const socketPath = sockPath("kolu-completely-silent-");
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
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
      let settled = false;
      const outcome = Effect.runPromise(Effect.result(converge(endpoint))).then(
        (result) => {
          settled = true;
          return result;
        },
      );
      for (let walked = 0; !settled; walked += 500) {
        if (walked > 4 * 35_000) throw new Error("converge never settled");
        await breathe(5);
        await vi.advanceTimersByTimeAsync(500);
      }
      const result = await outcome;
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure")
        throw new Error("foreign peer was adopted");
      expect(isSocketSquatterForeignError(result.failure)).toBe(true);
      if (!isSocketSquatterForeignError(result.failure)) throw result.failure;
      expect(
        result.failure.holders.some((holder) => holder.pid === process.pid),
      ).toBe(true);
      expect(failures).toHaveLength(3);
      for (const error of failures) {
        expect(error.message).toMatch(
          /control-core hello timed out after 30000ms/,
        );
      }
      expect(states).toContain("dead");
      expect(spawn).not.toHaveBeenCalled();
      expect(server.listening).toBe(true);
    } finally {
      vi.useRealTimers();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      rmSync(dirname(socketPath), { recursive: true });
    }
  }, 60_000);

  it("rejects on the baked deadline when a peer accepts the socket but never answers frozen hello", async () => {
    const socketPath = sockPath("kolu-hello-silent-");
    const listener = await serveFake(socketPath, {
      [HELLO_TAG]: () => Effect.never,
    });
    try {
      await expect(Effect.runPromise(connectKaval(socketPath))).rejects.toThrow(
        /control-core hello timed out after 30000ms/,
      );
    } finally {
      await listener.close();
    }
  }, 40_000);

  it("rejects on the 10s version deadline when the frozen hello answers but system.version never does", async () => {
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
    expect(isNoListenerError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isNoListenerError({ code: "ENOENT" })).toBe(true);
    expect(isNoListenerError({ cause: { code: "ECONNREFUSED" } })).toBe(true);
    expect(isNoListenerError({ code: "EPERM" })).toBe(false);
    expect(isNoListenerError(new Error("boom"))).toBe(false);
  });

  it("socket accepts but nothing ever answers ⇒ REJECTS (not null)", async () => {
    const socketPath = sockPath("kolu-probe-silent-");
    const server = createServer((sock) => {
      sock.on("error", () => {});
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
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await outcome;
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
      expect(destroySpy.mock.calls.length).toBeGreaterThan(destroysBefore);
    } finally {
      destroySpy.mockRestore();
      await listener.close();
    }
  });
});
