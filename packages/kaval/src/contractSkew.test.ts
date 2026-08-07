/**
 * **In-epoch contract skew**, expressed in the new wire.
 *
 * PLAN D6 splits what used to be one notion into two, and the split is the whole
 * point of this file:
 *
 *   - **Unspeakable protocol** — a peer from another protocol EPOCH. Its very
 *     first frame cannot be decoded, so it can never be asked its version. That
 *     is observed at the transport by `@kolu/surface-daemon-supervisor`, and it
 *     is not this package's business.
 *   - **In-epoch skew** — a peer that speaks the CURRENT protocol perfectly and
 *     reports a `contractVersion` we do not accept. That is `ptyHostSurface`'s
 *     own business, and it is what `PTY_HOST_CONTRACT_VERSION` +
 *     `isContractVersionCompatible` exist for. The 7.0 bump is not decoration:
 *     this mechanism has to keep working from the flag day forward, and a
 *     mechanism nobody exercises is a mechanism nobody can trust.
 *
 * So the harness here is a FAKE DAEMON that speaks the real ndjson wire over a
 * real unix socket, serves the real `surface/system/version` tag with the real
 * schema, and answers with a version string of the test's choosing. The client
 * dials it with the FULL surface group, exactly as padi does. Everything about
 * the transport succeeds; only the version string differs — which is precisely
 * the state a supervisor must classify as skew rather than as a broken link.
 *
 * The old harness (padi's `ptyHost/connect.test.ts`) built its fake from a
 * hand-written oRPC contract carrying a copy of `ptyHostSurface.contract.surface
 * .system.version`. The copy is gone: the fake below takes the LIVE `Rpc` out of
 * `ptyHostSurface.group`, so a fake can never drift from the surface it imitates.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import { Effect } from "effect";
import { RpcGroup } from "effect/unstable/rpc";
import { afterEach, expect, it } from "vitest";
import { ptyHostClientOver } from "./ptyHostClient.ts";
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "./ptyHostSurface.ts";

const VERSION_TAG = "surface/system/version";

const listeners: UnixSocketListener[] = [];
const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose().catch(() => {});
  for (const listener of listeners.splice(0)) listener.close();
});

/** A daemon from another BUILD: it speaks this exact protocol and serves this
 *  exact member, and reports `contractVersion`. Nothing else — which is also how
 *  an older daemon presents to a newer client that knows members it never had. */
async function serveFakeDaemon(contractVersion: string): Promise<string> {
  const version = ptyHostSurface.group.requests.get(VERSION_TAG);
  if (version === undefined) {
    throw new Error(
      `${VERSION_TAG} is not on the surface — the fake daemon imitates a member that moved.`,
    );
  }
  const handlers: SurfaceHandlers = Object.create(null);
  handlers[VERSION_TAG] = () =>
    Effect.succeed({
      contractVersion,
      pid: process.pid,
      startedAt: 1_700_000_000_000,
    });
  const socketPath = join(
    mkdtempSync(join(tmpdir(), "kaval-skew-")),
    "pty-host.sock",
  );
  const listener = await serveOverUnixSocket({
    socketPath,
    group: RpcGroup.make(version),
    handlers,
    log: silentLogger,
  });
  expect(listener.outcome).toEqual({ kind: "listening" });
  listeners.push(listener);
  return socketPath;
}

/** Dial a fake daemon with the FULL client group and read its handshake. */
async function readVersion(socketPath: string): Promise<string> {
  const link = await unixSocketLink({
    group: ptyHostSurface.group,
    socketPath,
  });
  disposers.push(() => link.dispose());
  const { contractVersion } = await Effect.runPromise(
    ptyHostClientOver(link.dispatch).surface.system.version({}),
  );
  return contractVersion;
}

describeDaemon("in-epoch contract skew over the Effect wire", () => {
  it("reads the handshake off a speakable peer whose version is NOT ours — the skew verdict is DATA, not a transport failure", async () => {
    // The distinction D6 rests on. If reading a skewed peer's version required
    // the read itself to fail, "skew" and "broken link" would be one
    // observation, and a supervisor could not tell a wrong-version daemon
    // (recycle it) from a foreign process squatting the socket (leave it alone).
    const reported = await readVersion(await serveFakeDaemon("7.4"));
    expect(reported).toBe("7.4");
    // …and the verdict is then computed, purely, from the two strings.
    expect(
      isContractVersionCompatible(reported, PTY_HOST_CONTRACT_VERSION),
    ).toBe(true);
  });

  it("a peer reporting an OLDER minor is refused — the additive-bump recycle direction", async () => {
    // The direction every minor bump in this contract's history has relied on: a
    // survivor that predates a new stream/field reports a lower minor and is
    // recycled BEFORE any call touches the member it lacks.
    const reported = await readVersion(await serveFakeDaemon("7.0"));
    expect(reported).toBe("7.0");
    expect(isContractVersionCompatible(reported, "7.3")).toBe(false);
  });

  it("a peer reporting a PREVIOUS-EPOCH version over the current protocol is refused", async () => {
    // The guard the 7.0 bump buys, stated as a test rather than as a comment.
    // Such a peer cannot exist as a real 6.x daemon (its framing is undecodable
    // — that is the unspeakable-protocol path), but a mislabeled or hand-rolled
    // build CAN present a 6.x string on this wire. Had the constant stayed at
    // "6.0", that string would have compared EQUAL to ours and been adopted as
    // wire-compatible: the pty-host's own version lever, silently disarmed
    // across the one break it most needed to name.
    const reported = await readVersion(await serveFakeDaemon("6.0"));
    expect(reported).toBe("6.0");
    expect(
      isContractVersionCompatible(reported, PTY_HOST_CONTRACT_VERSION),
    ).toBe(false);
  });

  it("a member the older peer never served fails as a MISSING ROUTE, not as an undecodable frame", async () => {
    // The other half of an older daemon: the client knows members the server
    // does not. That failure must stay distinguishable from a protocol break —
    // the link is up, the handshake read fine, and only this one call has
    // nowhere to land.
    const socketPath = await serveFakeDaemon(PTY_HOST_CONTRACT_VERSION);
    const link = await unixSocketLink({
      group: ptyHostSurface.group,
      socketPath,
    });
    disposers.push(() => link.dispose());
    const client = ptyHostClientOver(link.dispatch);
    await expect(
      Effect.runPromise(client.surface.system.version({})),
    ).resolves.toMatchObject({
      contractVersion: PTY_HOST_CONTRACT_VERSION,
    });
    await expect(
      Effect.runPromise(client.surface.terminal.list({})),
    ).rejects.toThrow();
  });
});
