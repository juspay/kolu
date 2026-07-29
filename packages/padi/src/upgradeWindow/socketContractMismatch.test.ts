/** Kolu-owned production `connectKaval` arm of the framework skew suite. */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { defineSurface } from "@kolu/surface/define";
import { implementSurface } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { z } from "zod";
import { connectKaval } from "../ptyHost/connect.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { PTY_HOST_CONTRACT_VERSION } from "kaval";

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

type UnixSocketRouter = Parameters<typeof serveOverUnixSocket>[0]["router"];

function skewedRouter(daemonVersion: string): UnixSocketRouter {
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
  return runtime.router as UnixSocketRouter;
}

const listeners: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
});

describeDaemon("socket-contract mismatch names itself (upgrade-window)", () => {
  it("connectKaval raises the typed skew with both versions", async () => {
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
        throw new Error("connectKaval resolved against a 1.0 peer");
      },
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(DaemonContractSkewError);
    const skew = rejection as DaemonContractSkewError;
    expect(skew.daemonVersion).toBe("1.0");
    expect(skew.requiredVersion).toBe(PTY_HOST_CONTRACT_VERSION);
    expect(skew.subject).toBe("pty-host");
    expect(skew.isContractSkew).toBe(true);
  });
});
