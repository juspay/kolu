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
import { RpcGroup } from "effect/rpc";
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
    const reported = await readVersion(await serveFakeDaemon("9.4"));
    expect(reported).toBe("9.4");
    expect(
      isContractVersionCompatible(reported, PTY_HOST_CONTRACT_VERSION),
    ).toBe(true);
  });

  it("a peer reporting an OLDER minor is refused — the additive-bump recycle direction", async () => {
    const reported = await readVersion(await serveFakeDaemon("9.0"));
    expect(reported).toBe("9.0");
    expect(isContractVersionCompatible(reported, "9.3")).toBe(false);
  });

  it("a peer reporting a PREVIOUS-EPOCH version over the current protocol is refused", async () => {
    const reported = await readVersion(await serveFakeDaemon("8.0"));
    expect(reported).toBe("8.0");
    expect(
      isContractVersionCompatible(reported, PTY_HOST_CONTRACT_VERSION),
    ).toBe(false);
  });

  it("a member the older peer never served fails as a MISSING ROUTE, not as an undecodable frame", async () => {
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
