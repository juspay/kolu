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
import { restart } from "./restart.ts";

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

  it("reports dead and throws when the driver's spawn rejects", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    const statuses: EndpointStatus<Identity>[] = [];
    let connectCalled = false;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      // A bad binPath / un-forkable systemd-run surfaces as a rejecting spawn.
      driver: {
        spawn: async () => {
          throw new Error("ENOENT: kaval binary not found");
        },
      },
      connect: async () => {
        connectCalled = true;
        throw new Error("connect should never run after a failed spawn");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await expect(endpoint.ensure()).rejects.toThrow("ENOENT");
    // The contract: failures publish `dead` before they throw, so the UI never
    // sticks at `connecting`. And a failed spawn must not reach the handshake.
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "dead"]);
    expect(connectCalled).toBe(false);
  });

  it("recycles a live survivor whose socket answers: kills the gate holder before spawning fresh", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A real live "survivor" whose pid sits in the gate AND whose socket is
    // accepting — the recycle guard SIGTERMs only when both hold (proof it's
    // really the daemon, not a reused pid).
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    const survivorExited = new Promise<void>((r) =>
      survivor.on("exit", () => r()),
    );

    // The survivor is "serving" — its socket is up before ensure(). The net
    // server is in-process (unrelated to the `sleep` pid), so SIGTERMing the pid
    // leaves it listening, and the post-spawn socket wait still finds it up.
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();
    let spawned = false;

    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: {
        spawn: async () => {
          // The recycle must have killed the survivor before we spawn.
          spawned = true;
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

  it("leaves a live gate-pid ALONE when its socket is dead (stale gate / reused pid)", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A live "stranger" whose pid happens to sit in the gate, but with NO socket
    // — the stale-gate-over-reused-pid hazard. The recycle must NOT SIGTERM it.
    const stranger = spawn("sleep", ["60"], { stdio: "ignore" });
    const strangerPid = stranger.pid as number;
    children.push(strangerPid);
    writeFileSync(gatePath, `${strangerPid}\n`);
    let strangerSignalled = false;
    stranger.on("exit", () => {
      strangerSignalled = true;
    });

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      // The fresh daemon brings the socket up — the stranger's pid is untouched.
      driver: { spawn: () => fake.listen() },
      connect: async () => ({
        client: "C",
        identity: { staleKey: "fresh" },
        startedAt: 3,
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
    });

    await endpoint.ensure();
    // Give any (erroneous) SIGTERM a tick to land.
    await new Promise((r) => setTimeout(r, 50));
    expect(strangerSignalled).toBe(false);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });
});

describe("adoptOrEnsure — survival boot", () => {
  it("adopts a live serving survivor: no kill, no fresh spawn", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A live "survivor" whose pid sits in the gate AND whose socket answers — a
    // compatible daemon a server-only redeploy should ADOPT, keeping its PTYs.
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    let survivorSignalled = false;
    survivor.on("exit", () => {
      survivorSignalled = true;
    });

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen(); // the survivor's socket is up before the boot

    let spawned = false;
    const statuses: EndpointStatus<Identity>[] = [];
    const adopted: DaemonConnection<string, Identity> = {
      client: "ADOPTED",
      identity: { staleKey: "survivor" },
      startedAt: 7,
      dispose() {},
      onClose() {},
    };
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: {
        spawn: async () => {
          spawned = true;
        },
      },
      connect: async () => adopted,
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.adoptOrEnsure();
    await new Promise((r) => setTimeout(r, 50));
    expect(survivorSignalled).toBe(false); // adopted, never killed
    expect(spawned).toBe(false); // no fresh daemon spawned
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    expect(endpoint.current()).toBe(adopted);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "survivor" });
  });

  it("recycles a survivor whose handshake fails (skew): kills it, spawns fresh", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    const survivorExited = new Promise<void>((r) =>
      survivor.on("exit", () => r()),
    );

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    let spawned = false;
    let connectCalls = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: {
        spawn: async () => {
          spawned = true;
        },
      },
      connect: async () => {
        connectCalls += 1;
        // First connect is the adopt attempt — reject it as an incompatible
        // survivor; the second is the post-recycle fresh daemon.
        if (connectCalls === 1) throw new Error("contract skew");
        return {
          client: "FRESH",
          identity: { staleKey: "fresh" },
          startedAt: 9,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
    });

    await endpoint.adoptOrEnsure();
    await survivorExited; // the skewed survivor was recycled
    expect(spawned).toBe(true);
    expect(connectCalls).toBe(2);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });
});

describe("serializeRestart — restart serialization", () => {
  it("coalesces concurrent restarts: one recycle, restarting observed once", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen(); // socket up; driver.spawn is a no-op

    const statuses: EndpointStatus<Identity>[] = [];
    let connectCalls = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: async () => {} },
      connect: async () => {
        connectCalls += 1;
        return {
          client: `C${connectCalls}`,
          identity: { staleKey: `k${connectCalls}` },
          startedAt: connectCalls,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure(); // → connecting, connected (connectCalls = 1)
    statuses.length = 0;

    let captures = 0;
    const steps = {
      capture: async () => {
        captures += 1;
      },
      drain: async () => {},
      reattach: async () => {},
    };
    // Two restarts fired in the same tick — the second must coalesce onto the
    // first (one recycle, one capture), and only the first emits `restarting`.
    const r1 = restart(endpoint, { ...steps });
    const r2 = restart(endpoint, { ...steps });
    await Promise.all([r1, r2]);

    expect(statuses.filter((s) => s.state === "restarting")).toHaveLength(1);
    expect(captures).toBe(1); // the second trigger did not run its own capture
    expect(connectCalls).toBe(2); // one recycle (boot + a single restart), not two
    // After the restart settles, the endpoint is connected again.
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k2" });
  });

  it("holds `restarting` through the recycle — the inner `connecting` is suppressed", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    let connectCalls = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: async () => {} },
      connect: async () => {
        connectCalls += 1;
        return {
          client: `C${connectCalls}`,
          identity: { staleKey: `k${connectCalls}` },
          startedAt: connectCalls,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure(); // → connecting, connected
    statuses.length = 0;

    // The recycle inside `restart` calls `ensure()`, which would normally emit
    // `connecting`. While a restart is in flight the endpoint must STAY at
    // `restarting` until it reaches `connected`, so a client that treats
    // `connecting` as "not down" can't flash the empty canvas mid-recycle (F4).
    await restart(endpoint, {
      capture: async () => {},
      drain: async () => {},
      reattach: async () => {},
    });

    expect(statuses.map((s) => s.state)).toEqual(["restarting", "connected"]);
    // The transient `connecting` from the recycle's `ensure()` was swallowed.
    expect(statuses.some((s) => s.state === "connecting")).toBe(false);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k2" });
  });

  it("holds `restarting` even when restarted from `degraded` (no connection held)", async () => {
    // F4 regression: a restart fired from the DegradedCanvas runs with `conn ===
    // undefined` (the mid-session close already demoted us to `degraded` and
    // cleared the connection). `restarting` must STILL be emitted and held, or
    // the inner recycle's `connecting` surfaces and a client that treats
    // `connecting` as "not down" flashes the empty canvas while kaval respawns.
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    let connectCalls = 0;
    let closeCb: (() => void) | undefined;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: async () => {} },
      connect: async () => {
        connectCalls += 1;
        return {
          client: `C${connectCalls}`,
          identity: { staleKey: `k${connectCalls}` },
          startedAt: connectCalls,
          dispose() {},
          onClose(cb) {
            closeCb = cb;
          },
        };
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure(); // → connecting, connected (conn held)
    closeCb?.(); // the daemon dies mid-session → degraded, conn cleared
    expect(endpoint.current()).toBeUndefined();
    statuses.length = 0;

    // Restart from the degraded surface — there is no held connection.
    await restart(endpoint, {
      capture: async () => {},
      drain: async () => {},
      reattach: async () => {},
    });

    // `restarting` is still emitted (no identity, since none was held), and the
    // inner recycle's `connecting` stays suppressed until the daemon is back.
    expect(statuses.map((s) => s.state)).toEqual(["restarting", "connected"]);
    const restartingStatus = statuses.find((s) => s.state === "restarting");
    expect(restartingStatus?.identity).toBeUndefined();
    expect(statuses.some((s) => s.state === "connecting")).toBe(false);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k2" });
  });

  it("a cold boot still emits `connecting` (the suppression is scoped to restart)", async () => {
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
      connect: async () => ({
        client: "C",
        identity: { staleKey: "k" },
        startedAt: 1,
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.ensure();
    // No restart in flight → the boot's `connecting` is reported as before.
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
  });
});
