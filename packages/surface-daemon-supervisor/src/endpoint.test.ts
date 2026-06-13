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
import { serializeRestart } from "./restart.ts";

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

describe("serializeRestart — the emit-guard + coalescing (B3.2)", () => {
  /** An endpoint over a persistent fake daemon (already listening, no gate
   *  file), so a restart's recycle is spawn(no-op) → connect — the kill path is
   *  covered by the boot-policy tests above; here we isolate the restart
   *  mechanism. `connect` hands back a fresh connection each call so a restart's
   *  re-connect is observable. */
  async function bootedEndpoint(): Promise<{
    endpoint: ReturnType<typeof createEndpoint<string, Identity>>;
    statuses: EndpointStatus<Identity>[];
    connectCount: () => number;
  }> {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid"); // no file → recycle skips the kill path
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    let connects = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: async () => {} }, // the fake is already serving
      connect: async () => {
        connects += 1;
        return {
          client: `C${connects}`,
          identity: { staleKey: `k${connects}` },
          startedAt: connects,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });
    await endpoint.ensure(); // boot: connecting → connected
    statuses.length = 0; // focus the assertions on the restart
    return { endpoint, statuses, connectCount: () => connects };
  }

  const noopSteps = {
    capture: async () => {},
    drain: async () => {},
    reattach: async () => {},
  };

  it("reports one `restarting` across the recycle then `connected` — never a bare `connecting`", async () => {
    const { endpoint, statuses } = await bootedEndpoint();

    await serializeRestart(endpoint)(noopSteps);

    const seq = statuses.map((s) => s.state);
    // The emit-guard coerced the recycle's `connecting` to `restarting`.
    expect(seq).not.toContain("connecting");
    expect(seq[0]).toBe("restarting");
    expect(seq.at(-1)).toBe("connected");
    // A fresh connection replaced the old one.
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k2" });
  });

  it("coalesces concurrent triggers into a single recycle", async () => {
    const { endpoint, statuses, connectCount } = await bootedEndpoint();

    const trigger = serializeRestart(endpoint);
    // Two callers fire in the same tick — the second must ride the first's
    // in-flight restart, not launch a second recycle.
    await Promise.all([trigger(noopSteps), trigger(noopSteps)]);

    // boot connected once; the coalesced restart connected exactly once more.
    expect(connectCount()).toBe(2);
    // One restarting, one connected — not two of each.
    expect(statuses.filter((s) => s.state === "connected")).toHaveLength(1);
  });

  it("a failed recycle ends the hold at `dead` (a real failure is not coerced)", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    let connects = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      gatePath,
      socketPath,
      driver: { spawn: async () => {} },
      connect: async () => {
        connects += 1;
        if (connects === 1) {
          return {
            client: "C",
            identity: { staleKey: "k1" },
            startedAt: 1,
            dispose() {},
            onClose() {},
          };
        }
        throw new Error("skew");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });
    await endpoint.ensure(); // boot ok
    statuses.length = 0;

    await expect(serializeRestart(endpoint)(noopSteps)).rejects.toThrow("skew");

    const seq = statuses.map((s) => s.state);
    expect(seq[0]).toBe("restarting");
    // `dead` passes through the guard — a failed recycle is not "still restarting".
    expect(seq.at(-1)).toBe("dead");
  });

  it("a capture failure (before the recycle) recovers to `connected`, not stuck `restarting` (F4)", async () => {
    const { endpoint, statuses } = await bootedEndpoint();

    // `capture` rejects BEFORE the recycle runs — the daemon connection is
    // untouched, so the honest state is still `connected`. Without recovery the
    // surface would stick at `restarting` forever (rail/buttons in-flight).
    await expect(
      serializeRestart(endpoint)({
        capture: async () => {
          throw new Error("snapshot write failed");
        },
        drain: async () => {},
        reattach: async () => {},
      }),
    ).rejects.toThrow("snapshot write failed");

    const seq = statuses.map((s) => s.state);
    expect(seq[0]).toBe("restarting");
    expect(seq.at(-1)).toBe("connected");
    // The recycle never ran — the original connection is still current.
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k1" });
  });

  it("a drain failure (before the recycle) recovers to `connected`, not stuck `restarting` (F4)", async () => {
    const { endpoint, statuses } = await bootedEndpoint();

    await expect(
      serializeRestart(endpoint)({
        capture: async () => {},
        drain: async () => {
          throw new Error("killAll failed");
        },
        reattach: async () => {},
      }),
    ).rejects.toThrow("killAll failed");

    const seq = statuses.map((s) => s.state);
    expect(seq[0]).toBe("restarting");
    expect(seq.at(-1)).toBe("connected");
    expect(endpoint.current()?.identity).toEqual({ staleKey: "k1" });
  });
});
