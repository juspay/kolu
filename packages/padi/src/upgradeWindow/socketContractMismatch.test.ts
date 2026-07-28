/**
 * Socket-contract mismatch names itself — a daemon speaking a different
 * contract version than the client expects must fire the `incompatible`
 * status arm (and `connectKaval` must raise `DaemonContractSkewError`).
 *
 * End-to-end enough that REMOVING the version gate in `connectKaval` fails
 * this test: we serve a real unix-socket peer that answers `system.version`
 * with contractVersion "1.0", then dial via the production `connectKaval`
 * path. Without the `isContractVersionCompatible` check, connect would
 * resolve and the skew error / incompatible status would never appear.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import type { Router } from "@orpc/server";
import {
  createEndpoint,
  DaemonContractSkewError,
  type EndpointStatus,
} from "@kolu/surface-daemon-supervisor";
import { z } from "zod";
import { connectKaval } from "../ptyHost/connect.ts";
import { PTY_HOST_CONTRACT_VERSION } from "kaval";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A minimal surface whose only job is to answer system.version with a
 *  deliberately OLD contract version — enough for connectKaval's handshake. */
const skewSurface = defineSurface({
  procedures: {
    system: {
      version: {
        input: z.object({}).default({}),
        output: z.object({
          contractVersion: z.string(),
          pid: z.number(),
          startedAt: z.number(),
        }),
      },
    },
  },
});

function skewedRouter(daemonVersion: string): Router<any, any> {
  const runtime = implementSurface(skewSurface, {
    procedures: {
      system: {
        version: async () => ({
          contractVersion: daemonVersion,
          pid: process.pid,
          startedAt: Date.now(),
        }),
      },
    },
  });
  return runtime.router as Router<any, any>;
}

const listeners: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const l of listeners.splice(0)) l.close();
});

describeDaemon("socket-contract mismatch names itself (upgrade-window)", () => {
  it("connectKaval raises DaemonContractSkewError with both versions when the peer speaks 1.0", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "upgrade-skew-")),
      "pty-host.sock",
    );
    const listener = await serveOverUnixSocket({
      socketPath,
      router: skewedRouter("1.0"),
      log: silentLog,
    });
    listeners.push(listener);
    expect(listener.outcome.kind).toBe("listening");

    const rejection = await connectKaval(socketPath).then(
      () => {
        throw new Error(
          "connectKaval resolved against a 1.0 peer — the version gate is gone",
        );
      },
      (err: unknown) => err,
    );

    expect(rejection).toBeInstanceOf(DaemonContractSkewError);
    const skew = rejection as DaemonContractSkewError;
    expect(skew.daemonVersion).toBe("1.0");
    expect(skew.requiredVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(skew.subject).toBe("pty-host");
    // Removing the version check in connect.ts makes connect resolve → this
    // assertion is the bite.
    expect(skew.isContractSkew).toBe(true);
  });

  it("endpoint adoptOrSpawnOrRefuse reports incompatible (never silent dead) on a skew connect", async () => {
    // Drive the status arm through the supervisor: connect throws the typed
    // skew (as connectKaval does), and the refuse policy names `incompatible`
    // with both versions. Mutate-to-prove: if the arm collapsed to `dead` or
    // `degraded`, the state assertion fails.
    const d = mkdtempSync(join(tmpdir(), "upgrade-incompat-"));
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // No live gate holder — adoptOrSpawnOrRefuse finds nothing to refuse via
    // the gate path and would spawn. We instead plant a live accept + force
    // connect to throw skew after a gate-less recovery... Simpler: use
    // adoptOrEnsure with a live survivor whose connect is the skew.
    const { spawn } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const { createServer } = await import("node:net");
    const survivor = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 60000)"],
      {
        stdio: "ignore",
      },
    );
    const survivorPid = survivor.pid as number;
    writeFileSync(gatePath, `${survivorPid}\n`);
    const server = createServer((s) => {
      s.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const statuses: EndpointStatus<{ staleKey: string }>[] = [];
    try {
      const endpoint = createEndpoint<string, { staleKey: string }>({
        hostId: "local",
        gatePath,
        socketPath,
        driver: {
          spawn: async () => {
            throw new Error("spawn must not run on a refuse-policy skew");
          },
        },
        connect: async () => {
          throw new DaemonContractSkewError({
            subject: "pty-host",
            daemonVersion: "1.0",
            requiredVersion: PTY_HOST_CONTRACT_VERSION,
            pid: survivorPid,
          });
        },
        log: silentLog,
        onStatus: (_h, s) => statuses.push(s),
        socketPollMs: 5,
        adoptConnectAttempts: 2,
        adoptConnectRetryMs: 1,
      });

      // kaval's policy is recycle-on-skew (adoptOrEnsure), which KILLS the
      // survivor. Pin the incompatible arm via adoptOrSpawnOrRefuse (refuse
      // policy) — the same status shape kaval emits mid-recycle when a FRESH
      // spawn still skews (SK4). For the refuse path:
      const adopted = await endpoint.adoptOrSpawnOrRefuse();
      expect(adopted).toBe(false);
      expect(statuses.map((s) => s.state)).toContain("incompatible");
      const last = statuses.at(-1);
      expect(last?.state).toBe("incompatible");
      if (last?.state === "incompatible") {
        expect(last.daemonVersion).toBe("1.0");
        expect(last.requiredVersion).toBe(PTY_HOST_CONTRACT_VERSION);
      }
    } finally {
      server.close();
      try {
        survivor.kill("SIGKILL");
      } catch {
        // gone
      }
    }
  });
});
