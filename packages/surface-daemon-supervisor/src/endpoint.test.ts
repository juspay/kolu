import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEndpoint,
  type DaemonConnection,
  type EndpointStatus,
} from "./endpoint.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

type Identity = { staleKey: string };

/** A fake daemon: a net server the driver "spawns" by listening on socketPath. */
function fakeDaemon(socketPath: string): {
  server: Server;
  listen: () => Promise<void>;
} {
  const server = createServer((sock) => {
    // Accept and hold the connection; the real handshake is the injected
    // connect, not the wire here.
    sock.on("error", () => {});
  });
  return {
    server,
    listen: () =>
      new Promise<void>((resolve) =>
        server.listen(socketPath, () => resolve()),
      ),
  };
}

const servers: Server[] = [];
const children: number[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

function dir(): string {
  return mkdtempSync(join(tmpdir(), "sds-endpoint-"));
}

describe("createEndpoint — boot, status, death", () => {
  it("with no survivor: connecting → connected with identity + startedAt", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const statuses: EndpointStatus<Identity>[] = [];
    let closeCb: (() => void) | undefined;
    const conn: DaemonConnection<string, Identity> = {
      client: "CLIENT",
      identity: { staleKey: "abc" },
      startedAt: 111,
      dispose() {},
      onClose(cb) {
        closeCb = cb;
      },
    };

    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: () => fake.listen() },
      connect: async () => conn,
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure();
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    const connected = statuses.find((s) => s.state === "connected");
    expect(connected?.identity).toEqual({ staleKey: "abc" });
    expect(connected?.startedAt).toBe(111);
    expect(endpoint.current()).toBe(conn);
    expect(closeCb).toBeTypeOf("function");
  });

  it("flips to degraded when the connection closes mid-session", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const statuses: EndpointStatus<Identity>[] = [];
    let closeCb: (() => void) | undefined;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: () => fake.listen() },
      connect: async () => ({
        client: "C",
        identity: { staleKey: "k" },
        startedAt: 1,
        dispose() {},
        onClose(cb) {
          closeCb = cb;
        },
      }),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure();
    closeCb?.();
    expect(statuses.map((s) => s.state)).toEqual([
      "connecting",
      "connected",
      "degraded",
    ]);
    expect(endpoint.current()).toBeUndefined();
  });

  it("reports dead and throws when connect rejects", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: () => fake.listen() },
      connect: async () => {
        throw new Error("skew");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await expect(endpoint.ensure()).rejects.toThrow("skew");
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "dead"]);
  });

  it("recycles a live survivor: kills the gate holder before spawning fresh", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A real live "survivor" whose pid sits in the gate.
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    const survivorExited = new Promise<void>((r) =>
      survivor.on("exit", () => r()),
    );

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    let spawned = false;

    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: {
        spawn: async () => {
          // The recycle must have killed the survivor before we spawn.
          spawned = true;
          await fake.listen();
        },
      },
      connect: async () => ({
        client: "C",
        identity: { staleKey: "fresh" },
        startedAt: 2,
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
    });

    await endpoint.ensure();
    await survivorExited; // the boot policy killed it
    expect(spawned).toBe(true);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });
});
