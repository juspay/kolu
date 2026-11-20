import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import type { SurfaceHandler, SurfaceHandlers } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { kavalDaemonGroup, PTY_HOST_CONTRACT_VERSION } from "kaval";
import { afterEach, expect, it } from "vitest";
import { connectKaval } from "../ptyHost/connect.ts";

const HELLO_TAG = "surface/control/core/hello";
const VERSION_TAG = "surface/system/version";

const listeners: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
});

async function serveSkewed(socketPath: string, daemonVersion: string) {
  const startedAt = 424_242;
  const byTag: Record<string, SurfaceHandler> = {
    [HELLO_TAG]: () =>
      Effect.succeed({
        stateRoot: "/run/kaval-skewed",
        surfaceVersion: daemonVersion,
        controlCoreVersion: "1.0",
        startedAt,
      }),
    [VERSION_TAG]: () =>
      Effect.succeed({
        contractVersion: daemonVersion,
        pid: process.pid,
        startedAt,
      }),
  };
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
    log: silentLogger,
  });
  expect(listener.outcome).toEqual({ kind: "listening" });
  listeners.push(listener);
  return listener;
}

describeDaemon("socket-contract mismatch names itself (upgrade-window)", () => {
  it("connectKaval raises the typed skew with both versions", async () => {
    const socketPath = join(
      mkdtempSync(join(tmpdir(), "upgrade-skew-")),
      "pty-host.sock",
    );
    await serveSkewed(socketPath, "1.0");

    const rejection = await Effect.runPromise(connectKaval(socketPath)).then(
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
    expect(skew.pid).toBe(process.pid);
  });
});
