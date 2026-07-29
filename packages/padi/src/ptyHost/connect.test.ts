/**
 * The connect middle-hop for the Kaval-lifetime mirror (F6): `connectKaval`
 * reads `system.version` off a live kaval and copies its OPTIONAL `lifetime`
 * onto the connection `metadata` (`connect.ts` → `metadata.lifetime`). Because
 * `KavalConnectionMetadata.lifetime` is optional (a survivor predating the field
 * reports none), deleting that copy still type-checks — so the passthrough needs
 * a behavioural pin, not just the schema round-trip. This dials a REAL kaval over
 * a REAL unix socket (the exact `dialSocket` + `stdioLink` path production uses)
 * and asserts the served lifetime arrives on the metadata.
 */

import { mkdtempSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import {
  controlCoreFragment,
  controlCoreSurface,
  daemonBuild,
} from "@kolu/surface-daemon";
import { implementSurfaces } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import {
  type PtyHostSocketListener,
  PTY_HOST_CONTRACT_VERSION,
  createInProcessPtyHost,
  ptyHostSurface,
  serveKavalDaemonSurface,
  servePtyHostOverUnixSocket,
} from "kaval";
import {
  decide,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectKaval,
  isNoListenerError,
  probeKavalForConvergence,
} from "./connect.ts";
import { silentLogger as silentLog } from "@kolu/surface-remote/loggerStubs.testutil";

const legacyVersionOnlyContract = oc.router({
  surface: {
    system: {
      version: ptyHostSurface.contract.surface.system.version,
    },
  },
});

/** Serve a kaval whose resolved lifetime is `boundToPid` (the CI/smoke policy),
 *  so a copy of the value can be distinguished from the production `forever`. */
function makePtyHost() {
  return createInProcessPtyHost({
    log: silentLog,
    rcDir: mkdtempSync(join(tmpdir(), "kolu-connect-rc-")),
    lifetime: { kind: "boundToPid", pid: 4242 },
  });
}

function serveLegacy(socketPath: string): Promise<PtyHostSocketListener> {
  const { servedRouter } = makePtyHost();
  return servePtyHostOverUnixSocket({
    socketPath,
    router: servedRouter,
    log: silentLog,
  });
}

async function serveCurrent(socketPath: string) {
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
  const runtime = serveKavalDaemonSurface({
    ptyHost,
    stateRoot: "/run/kaval-current",
  });
  const listener = await servePtyHostOverUnixSocket({
    socketPath,
    router: runtime.router,
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
    router: runtime.router as never,
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

/** A pre-fragment daemon that reports a chosen observed contract version. It
 * deliberately serves no frozen route and carries a tempting legacy build id,
 * which the transition probe must discard. */
async function serveLegacyVersionOnly(
  socketPath: string,
  contractVersion: string,
) {
  const startedAt = 424_242;
  const t = implement(legacyVersionOnlyContract);
  const router = t.router({
    surface: {
      system: {
        version: t.surface.system.version.handler(() => ({
          contractVersion,
          pid: process.pid,
          startedAt,
          lifetime: { kind: "forever" as const },
          identity: {
            staleKey: "legacy-build-must-not-be-trusted",
            navigableCommit: "legacy-commit-must-not-be-trusted",
          },
        })),
      },
    },
  });
  const listener = await serveOverUnixSocket({
    socketPath,
    router,
    log: silentLog,
  });
  return { listener, startedAt };
}

describe("connectKaval — mirrors the handshake lifetime onto the metadata", () => {
  let listener: Awaited<ReturnType<typeof serveCurrent>>;
  let socketPath: string;

  beforeAll(async () => {
    socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-connect-sock-")),
      "pty-host.sock",
    );
    listener = await serveCurrent(socketPath);
  });

  afterAll(async () => await listener.close());

  it("carries the served lifetime through to metadata.lifetime", async () => {
    const conn = await connectKaval(socketPath);
    try {
      // The whole point of F6: this fails (undefined) if the `lifetime:
      // version.lifetime` copy in connect.ts is dropped, even though the type
      // stays green because the field is optional.
      expect(conn.metadata.lifetime).toEqual({ kind: "boundToPid", pid: 4242 });
      expect(conn.metadata.contractVersion).toBeTypeOf("string");
      expect(conn.identity).toEqual({
        staleKey: "fragment-build",
        navigableCommit: "fragment-commit",
      });
    } finally {
      conn.dispose();
    }
  });
});

describe("connectKaval — identity comes only from frozen hello", () => {
  it("projects honest unknown instead of copying system.version identity when an old daemon lacks the fragment", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-connect-legacy-")),
      "pty-host.sock",
    );
    const listener = await serveLegacy(socketPath);
    try {
      const conn = await connectKaval(socketPath);
      try {
        const legacyVersion = await conn.client.surface.system.version({});
        expect(legacyVersion.identity).toBeDefined();
        expect(conn.identity).toEqual({
          staleKey: "",
          navigableCommit: "",
        });
      } finally {
        conn.dispose();
      }
    } finally {
      listener.close();
    }
  });
});

describe("connectKaval — the handshake read is bounded (F2)", () => {
  it("rejects on the baked deadline when a peer accepts the socket but never answers frozen hello", async () => {
    // A foreign squatter (or wedged daemon) accepts the unix connection but sends
    // no oRPC reply — without a deadline the read would pend forever and hang boot,
    // and the gate-less-squatter recovery would never reach its foreign refusal.
    // `connectKaval` carries NO deadline override (fail-fast: no knobs), so this
    // drives the supervisor's single baked policy under FAKE timers — production
    // and this test run the same parameterless implementation, just with the clock
    // advanced.
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-silent-")),
      "pty-host.sock",
    );
    const server = createServer(() => {
      // accept, then never respond
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    // Fake ONLY setTimeout so the real dial + version-send still progress over IO;
    // the deadline timer is the one thing under our control.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const outcome = connectKaval(socketPath).then(
        () => "resolved",
        (e: unknown) => (e as Error).message,
      );
      // Let the real dial complete and the deadline timer arm (setImmediate is not faked).
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(outcome).resolves.toMatch(
        /control-core hello timed out after 30000ms/,
      );
    } finally {
      vi.useRealTimers();
      server.close();
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
    await expect(probeKavalForConvergence(missing)).resolves.toBeNull();
  });

  it("old daemon exiting between missing-fragment detection and the legacy redial ⇒ null", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-legacy-exit-")),
      "pty-host.sock",
    );
    const listener = await serveLegacy(socketPath);
    const realDestroy = Socket.prototype.destroy;
    let listenerClosed = false;
    const destroySpy = vi
      .spyOn(Socket.prototype, "destroy")
      .mockImplementation(function (this: Socket, error?: Error) {
        if (!listenerClosed) {
          listenerClosed = true;
          listener.close();
        }
        return realDestroy.call(this, error);
      });
    try {
      await expect(probeKavalForConvergence(socketPath)).resolves.toBeNull();
      expect(listenerClosed).toBe(true);
    } finally {
      destroySpy.mockRestore();
      listener.close();
    }
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

  it("socket accepts but handshake never answers ⇒ REJECTS (not null)", async () => {
    // Distinguishes catch-to-null (wave-6 regression) from honest absence:
    // resolving null here would mute the failure and adopt nothing as free.
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-silent-")),
      "pty-host.sock",
    );
    const server = createServer(() => {
      // accept, never answer control.core.hello
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const outcome = probeKavalForConvergence(socketPath).then(
        (v) => (v === null ? "null" : "probe"),
        (e: unknown) => (e as Error).message,
      );
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await outcome;
      // Must reject with the deadline message — never resolve null.
      expect(result).not.toBe("null");
      expect(result).not.toBe("probe");
      expect(result).toMatch(/control-core hello timed out after 30000ms/);
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });

  it("pre-fragment fallback preserves the old daemon's observed version and boot, never its legacy build identity", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-legacy-version-")),
      "pty-host.sock",
    );
    const { listener, startedAt } = await serveLegacyVersionOnly(
      socketPath,
      "5.4",
    );
    try {
      const probe = await probeKavalForConvergence(socketPath);
      expect(probe).not.toBeNull();
      if (probe === null) throw new Error("legacy served daemon became null");
      expect(probe.identity).toEqual({
        contractVersion: "5.4",
        build: { kind: "off-nix" },
      });
      expect(probe.instanceKey).toEqual(instanceKeyFromStartedAt(startedAt));
      probe.dispose();
    } finally {
      listener.close();
    }
  });

  it("pre-fragment daemon on the same contract is an older-build nudge, never a clean adopt", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-legacy-nudge-")),
      "pty-host.sock",
    );
    const { listener } = await serveLegacyVersionOnly(
      socketPath,
      PTY_HOST_CONTRACT_VERSION,
    );
    try {
      const probe = await probeKavalForConvergence(socketPath);
      expect(probe).not.toBeNull();
      if (probe === null) throw new Error("legacy served daemon became null");
      expect(
        decide(
          {
            capability: "not-drainable",
            baked: {
              contractVersion: PTY_HOST_CONTRACT_VERSION,
              build: daemonBuild("current-kaval-build"),
            },
            onContractSkew: { kind: "recycle" },
            onBuildMismatch: { kind: "nudge-human" },
          },
          probe.identity,
        ),
      ).toMatchObject({ kind: "report-mismatch" });
      probe.dispose();
    } finally {
      listener.close();
    }
  });

  it("fragment-only server ⇒ frozen identity + startedAt key + observed dispose", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "kolu-probe-live-")),
      "pty-host.sock",
    );
    const listener = await serveFrozenIdentity(socketPath);
    // Spy the production Socket.destroy boundary — a no-op dispose leaves this
    // call count unchanged and turns the test red (W8.2).
    const destroySpy = vi.spyOn(Socket.prototype, "destroy");
    try {
      const probe = await probeKavalForConvergence(socketPath);
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
