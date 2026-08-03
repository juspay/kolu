/**
 * Kolu-owned production `connectKaval` arm of the framework skew suite.
 *
 * The peer here is IN-EPOCH: it speaks this protocol, its frames decode, its
 * `system.version` answers — and it reports a contract version this build
 * refuses. That is the whole point after PLAN D6. An undecodable peer is a
 * TRANSPORT fact the supervisor names `unspeakable-protocol` (and kaval's policy
 * recycles); a decodable peer with a wrong version is DATA, and the failure has
 * to arrive as the typed {@link DaemonContractSkewError} carrying both versions
 * so the recycleKaval rethrow and the `incompatible` status arm can read them
 * structurally rather than re-parsing prose.
 *
 * The fake is built from the LIVE `Rpc`s in `kavalDaemonGroup` (the model
 * `ptyHost/connect.test.ts` and kaval's `contractSkew.test.ts` share), so it
 * cannot drift from the surface it imitates: naming a tag kaval does not serve
 * is an error here, not a silently-diverging hand-copied contract.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import type { SurfaceHandler, SurfaceHandlers } from "@kolu/surface/server";
import { serveOverUnixSocket } from "@kolu/surface/unix-socket";
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { RpcGroup } from "effect/unstable/rpc";
import { kavalDaemonGroup, PTY_HOST_CONTRACT_VERSION } from "kaval";
import { afterEach, expect, it } from "vitest";
import { connectKaval } from "../ptyHost/connect.ts";

const HELLO_TAG = "surface/control/core/hello";
const VERSION_TAG = "surface/system/version";

const listeners: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const listener of listeners.splice(0)) listener.close();
});

/** Serve a daemon whose BOTH handshake surfaces agree on `daemonVersion` — the
 *  honest shape of a peer from a different contract generation. Disagreeing
 *  surfaces are a different failure (`connect.test.ts` pins that one), so this
 *  fixture keeps them in step and leaves only the version compare under test. */
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
    // The skewed daemon's OWN pid rides the error, so the gate-less-squatter
    // recovery has its third identity attestation even though no connection
    // was ever established.
    expect(skew.pid).toBe(process.pid);
  });
});
