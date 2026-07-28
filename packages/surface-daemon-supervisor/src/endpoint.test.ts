import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeDaemon } from "@kolu/daemon-test-gate";
import {
  createEndpoint,
  type DaemonConnection,
  DaemonContractSkewError,
  type EndpointStatus,
} from "./endpoint.ts";
import { endpointPrivate } from "./endpoint.private.ts";
import { serializeRestart } from "./restart.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A `DaemonContractSkewError` for tests — defaults to the common pty-host
 *  5.0-vs-5.2 skew, overridable per case (the padi-axis suite passes its own).
 *  One spelling of the SK2 payload shape, so a field change is a one-site edit. */
const skewError = ({
  subject = "pty-host",
  daemonVersion = "5.0",
  requiredVersion = "5.2",
}: {
  subject?: string;
  daemonVersion?: string;
  requiredVersion?: string;
} = {}): DaemonContractSkewError =>
  new DaemonContractSkewError({ subject, daemonVersion, requiredVersion });

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

describeDaemon("createEndpoint — boot, status, death", () => {
  it("with no survivor: connecting → connected with identity + startedAt", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const statuses: EndpointStatus<Identity, { contractVersion: string }>[] =
      [];
    let closeCb: (() => void) | undefined;
    const conn: DaemonConnection<
      string,
      Identity,
      { contractVersion: string }
    > = {
      client: "CLIENT",
      identity: { staleKey: "abc" },
      startedAt: 111,
      metadata: { contractVersion: "5.0" },
      dispose() {},
      onClose(cb) {
        closeCb = cb;
      },
    };

    const endpoint = createEndpoint<
      string,
      Identity,
      { contractVersion: string }
    >({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: () => fake.listen() },
      connect: async (_socketPath) => conn,
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpointPrivate(endpoint).ensure();
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    const connected = statuses.find((s) => s.state === "connected");
    expect(connected?.identity).toEqual({ staleKey: "abc" });
    expect(connected?.startedAt).toBe(111);
    expect(connected?.metadata).toEqual({ contractVersion: "5.0" });
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: () => fake.listen() },
      connect: async (_socketPath) => ({
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

    await endpointPrivate(endpoint).ensure();
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: () => fake.listen() },
      connect: async (_socketPath) => {
        throw new Error("skew");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await expect(endpointPrivate(endpoint).ensure()).rejects.toThrow("skew");
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      // A bad binPath / un-forkable systemd-run surfaces as a rejecting spawn.
      driver: {
        spawn: async () => {
          throw new Error("ENOENT: kaval binary not found");
        },
      },
      connect: async (_socketPath) => {
        connectCalled = true;
        throw new Error("connect should never run after a failed spawn");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await expect(endpointPrivate(endpoint).ensure()).rejects.toThrow("ENOENT");
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          // The recycle must have killed the survivor before we spawn.
          spawned = true;
        },
      },
      connect: async (_socketPath) => ({
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

    await endpointPrivate(endpoint).ensure();
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      // The fresh daemon brings the socket up — the stranger's pid is untouched.
      driver: { spawn: () => fake.listen() },
      connect: async (_socketPath) => ({
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

    await endpointPrivate(endpoint).ensure();
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: async () => {} }, // the fake is already serving
      connect: async (_socketPath) => {
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
    await endpointPrivate(endpoint).ensure(); // boot: connecting → connected
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
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: async () => {} },
      connect: async (_socketPath) => {
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
    await endpointPrivate(endpoint).ensure(); // boot ok
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

describeDaemon("adoptOrEnsure — adopt-or-recycle boot (B3.3)", () => {
  it("ADOPTS a live, handshake-compatible survivor: no kill, no spawn, holds it", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A real live survivor: its pid sits in the gate AND its socket answers — the
    // adopt candidate. Unlike `ensure`, `adoptOrEnsure` must connect to it, not
    // kill it.
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    let survivorExited = false;
    survivor.on("exit", () => {
      survivorExited = true;
    });

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen(); // the survivor is serving before the boot

    let spawnCalled = false;
    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          spawnCalled = true;
        },
      },
      // The handshake succeeds → the survivor is compatible → adopt it.
      connect: async (_socketPath) => ({
        client: "SURVIVOR",
        identity: { staleKey: "survivor" },
        startedAt: 99,
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    // Give any (erroneous) SIGTERM a tick to land.
    await new Promise((r) => setTimeout(r, 50));

    expect(adopted).toBe(true);
    expect(spawnCalled).toBe(false); // never spawned a fresh daemon
    expect(survivorExited).toBe(false); // never killed the survivor
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "connected"]);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "survivor" });
    // The survivor's OLD startedAt survives — the uptime that did NOT reset is
    // the honest "this daemon was reused" signal.
    expect(statuses.find((s) => s.state === "connected")?.startedAt).toBe(99);
  });

  it("ADOPTS a survivor whose connect fails transiently then succeeds on retry (F4)", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A real live survivor with live PTYs at stake. Its first connect rejects on
    // a transient transport hiccup; the retry succeeds. The endpoint must NOT
    // recycle on the one-off failure — that would kill the survivor's PTYs.
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    let survivorExited = false;
    survivor.on("exit", () => {
      survivorExited = true;
    });

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    let spawnCalled = false;
    let connectCount = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          spawnCalled = true;
        },
      },
      connect: async (_socketPath) => {
        connectCount += 1;
        if (connectCount === 1) throw new Error("ECONNRESET (transient)");
        return {
          client: "SURVIVOR",
          identity: { staleKey: "survivor" },
          startedAt: 7,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectRetryMs: 1, // keep the test fast
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    await new Promise((r) => setTimeout(r, 20));

    expect(adopted).toBe(true); // adopted on the retry, not recycled
    expect(connectCount).toBe(2); // failed once, succeeded on the second attempt
    expect(spawnCalled).toBe(false); // never spawned a fresh daemon
    expect(survivorExited).toBe(false); // never killed the survivor
    expect(endpoint.current()?.identity).toEqual({ staleKey: "survivor" });
  });

  it("RECYCLES a survivor that is a genuine contract skew: kills it WITHOUT retrying, spawns fresh, returns false (F4)", async () => {
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

    // In-process net server (unrelated to the sleep pid), so killing the survivor
    // leaves the socket up for the post-recycle spawn's socket wait + connect.
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    let spawned = false;
    let connectCount = 0;
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          spawned = true;
        },
      },
      connect: async (_socketPath) => {
        connectCount += 1;
        // A genuine skew (the typed error) is TERMINAL: it proves the contract is
        // incompatible, so the endpoint must recycle on the FIRST one — never
        // burn retries re-dialing a daemon that can't become compatible. Only the
        // post-recycle fresh spawn connects.
        if (connectCount === 1) {
          throw skewError();
        }
        return {
          client: "FRESH",
          identity: { staleKey: "fresh" },
          startedAt: 2,
          dispose() {},
          onClose() {},
        };
      },
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
      adoptConnectAttempts: 3, // generous budget, but skew short-circuits at 1
      adoptConnectRetryMs: 1,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    await survivorExited; // the skewed survivor was killed before the fresh spawn

    expect(adopted).toBe(false); // recycled, not adopted
    expect(spawned).toBe(true); // a fresh daemon was spawned after the kill
    // 1 skew (no retry — skew is terminal) + 1 fresh connect = 2, NOT 4.
    expect(connectCount).toBe(2);
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });

  it("a recycle whose FRESH SPAWN still skews reports incompatible with both versions — never dead (SK4)", async () => {
    // The field failure's terminal shape (bug-remote-kaval-contract-skew): the
    // skewed survivor is recycled, but the respawn from the currently-realised
    // closure ALSO skews — proof that no respawn can converge this endpoint.
    // Reporting `dead` here is the collapse that made the UI offer the exact
    // retry that just failed; the honest verdict is `incompatible`, versions
    // attached, so every affordance downstream can refuse to offer a restart.
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

    // The in-process socket stays up across the kill (it is not the sleep pid),
    // so the post-recycle spawn's socket wait passes and `connect` runs again.
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: async () => {} },
      // EVERY connect skews — the survivor AND the fresh spawn: the closure on
      // this host cannot speak the required contract, whoever runs it.
      connect: async (_socketPath) => {
        throw skewError();
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectAttempts: 3,
      adoptConnectRetryMs: 1,
    });

    await expect(
      endpointPrivate(endpoint).adoptOrEnsure(),
    ).rejects.toMatchObject({
      isContractSkew: true,
    });
    await survivorExited; // the skewed survivor was still recycled (killed)

    // The terminal status is the PROVEN verdict, payload attached — never `dead`.
    expect(statuses.map((s) => s.state)).toEqual([
      "connecting",
      "incompatible",
    ]);
    const last = statuses.at(-1);
    if (last?.state === "incompatible") {
      expect(last.daemonVersion).toBe("5.0");
      expect(last.requiredVersion).toBe("5.2");
    }
  });

  it("an incompatible verdict inside a restart hold is NOT coerced to restarting (SK4)", async () => {
    // `holdRestarting` coerces the recycle's transient `connecting`/`degraded`
    // into one honest "restarting" — but a proven skew is the restart's
    // terminal VERDICT, not a transition: repainting it as `restarting` would
    // show progress against a daemon a restart cannot fix. The hold must let
    // `incompatible` through, and the hold's recovery must not stomp it.
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: async () => {} },
      connect: async (_socketPath) => {
        throw skewError();
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
    });

    await endpoint.holdRestarting(async () => {
      await endpointPrivate(endpoint)
        .ensure()
        .catch(() => {});
    });

    // `connecting` was coerced into the hold's `restarting`; the skew verdict
    // passed through UN-coerced and stands as the last word (never `dead`,
    // never a lingering `restarting`).
    expect(statuses.map((s) => s.state)).toEqual([
      "restarting",
      "restarting",
      "incompatible",
    ]);
  });

  it("does NOT kill a survivor whose NON-skew connect fails every attempt: leaves it up, reports degraded, returns false (F4)", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid");

    // A real live survivor holding live PTYs. Its connect rejects on a NON-skew
    // failure (a transport/handshake-read hiccup) on EVERY attempt — but that is
    // NOT proof it is incompatible. The endpoint must NOT recycle it: killing the
    // survivor would destroy the very PTYs adoption exists to preserve.
    const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
    const survivorPid = survivor.pid as number;
    children.push(survivorPid);
    writeFileSync(gatePath, `${survivorPid}\n`);
    let survivorExited = false;
    survivor.on("exit", () => {
      survivorExited = true;
    });

    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);
    await fake.listen();

    let spawnCalled = false;
    let connectCount = 0;
    const statuses: EndpointStatus<Identity>[] = [];
    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: {
        spawn: async () => {
          spawnCalled = true;
        },
      },
      connect: async (_socketPath) => {
        connectCount += 1;
        // Plain Error (NOT a DaemonContractSkewError) → non-skew, possibly
        // transient. Here it persists across every attempt.
        throw new Error("ECONNRESET (persistent transport failure)");
      },
      log: silentLog,
      onStatus: (_h, s) => statuses.push(s),
      socketPollMs: 5,
      adoptConnectAttempts: 3,
      adoptConnectRetryMs: 1,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    await new Promise((r) => setTimeout(r, 20));

    expect(adopted).toBe(false); // nothing adopted, nothing to reconcile
    expect(connectCount).toBe(3); // retried every attempt before giving up
    expect(spawnCalled).toBe(false); // NEVER spawned a fresh daemon
    expect(survivorExited).toBe(false); // NEVER killed the survivor (PTYs preserved)
    expect(endpoint.current()).toBeUndefined(); // no working connection held
    // Reports degraded: a daemon is there, but we hold no connection to it.
    expect(statuses.map((s) => s.state)).toEqual(["connecting", "degraded"]);
  });

  it("with NO survivor: spawns fresh and returns false (a cold boot)", async () => {
    const d = dir();
    const socketPath = join(d, "x.sock");
    const gatePath = join(d, "x.pid"); // no gate file → no survivor
    const fake = fakeDaemon(socketPath);
    servers.push(fake.server);

    const endpoint = createEndpoint<string, Identity>({
      hostId: "local",
      home: { dir: dirname(socketPath), gatePath, socketPath },
      policy: {
        capability: "not-drainable",
        baked: {
          contractVersion: "test",
          build: { kind: "known", id: "test-build" },
        },
        onContractSkew: { kind: "recycle" },
        onBuildMismatch: { kind: "nudge-human" },
      },
      probe: async () => null,
      driver: { spawn: () => fake.listen() },
      connect: async (_socketPath) => ({
        client: "FRESH",
        identity: { staleKey: "fresh" },
        startedAt: 1,
        dispose() {},
        onClose() {},
      }),
      log: silentLog,
      onStatus: () => {},
      socketPollMs: 5,
    });

    const adopted = await endpointPrivate(endpoint).adoptOrEnsure();
    expect(adopted.kind).not.toBe("adopted-resident");
    expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
  });
});

describeDaemon(
  "adoptOrSpawnOrRefuse — the padi binder's boot policy (W2.2)",
  () => {
    it("REFUSES a survivor that is a contract skew: leaves it up (NO kill, NO spawn), reports incompatible with both versions, returns false", async () => {
      const d = dir();
      const socketPath = join(d, "x.sock");
      const gatePath = join(d, "x.pid");

      // A real live survivor holding live PTYs. It is a contract SKEW — but clients
      // NEVER kill a running padi (the #1313 inversion): a dev/second binder that
      // can't talk this padi's contract must not SIGTERM the daemon that owns
      // another's terminals. So it is left STANDING + degraded, unlike
      // `adoptOrEnsure`, which would recycle (kill) it.
      const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
      const survivorPid = survivor.pid as number;
      children.push(survivorPid);
      writeFileSync(gatePath, `${survivorPid}\n`);
      let survivorExited = false;
      survivor.on("exit", () => {
        survivorExited = true;
      });

      const fake = fakeDaemon(socketPath);
      servers.push(fake.server);
      await fake.listen();

      let spawnCalled = false;
      let connectCount = 0;
      const statuses: EndpointStatus<Identity>[] = [];
      const endpoint = createEndpoint<string, Identity>({
        hostId: "local",
        home: { dir: dirname(socketPath), gatePath, socketPath },
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            spawnCalled = true;
          },
        },
        connect: async (_socketPath) => {
          connectCount += 1;
          throw skewError({
            subject: "padiSurface",
            daemonVersion: "3.0",
            requiredVersion: "4.0",
          });
        },
        log: silentLog,
        onStatus: (_h, s) => statuses.push(s),
        socketPollMs: 5,
        adoptConnectAttempts: 3,
        adoptConnectRetryMs: 1,
      });

      const adopted = await endpointPrivate(endpoint).adoptOrSpawnOrRefuse();
      // Give any (erroneous) SIGTERM a tick to land.
      await new Promise((r) => setTimeout(r, 50));

      expect(adopted).toBe(false); // refused, not adopted
      expect(spawnCalled).toBe(false); // NEVER spawned a fresh daemon over it
      expect(survivorExited).toBe(false); // NEVER killed the running padi (the delta)
      expect(connectCount).toBe(1); // skew is terminal — no retries
      expect(endpoint.current()).toBeUndefined(); // no connection held
      // Reports the PROVEN verdict by name (SK4): `incompatible`, carrying both
      // contract versions off the typed error's fields — never a plain `degraded`
      // that a UI cannot distinguish from "unreachable"/"died mid-session".
      expect(statuses.map((s) => s.state)).toEqual([
        "connecting",
        "incompatible",
      ]);
      const last = statuses.at(-1);
      expect(last?.state).toBe("incompatible");
      if (last?.state === "incompatible") {
        expect(last.daemonVersion).toBe("3.0");
        expect(last.requiredVersion).toBe("4.0");
      }
    });

    it("ADOPTS a live, handshake-compatible survivor: no kill, no spawn, holds it", async () => {
      const d = dir();
      const socketPath = join(d, "x.sock");
      const gatePath = join(d, "x.pid");

      const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
      const survivorPid = survivor.pid as number;
      children.push(survivorPid);
      writeFileSync(gatePath, `${survivorPid}\n`);
      let survivorExited = false;
      survivor.on("exit", () => {
        survivorExited = true;
      });

      const fake = fakeDaemon(socketPath);
      servers.push(fake.server);
      await fake.listen();

      let spawnCalled = false;
      const endpoint = createEndpoint<string, Identity>({
        hostId: "local",
        home: { dir: dirname(socketPath), gatePath, socketPath },
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            spawnCalled = true;
          },
        },
        connect: async (_socketPath) => ({
          client: "SURVIVOR",
          identity: { staleKey: "survivor" },
          startedAt: 42,
          dispose() {},
          onClose() {},
        }),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
      });

      const adopted = await endpointPrivate(endpoint).adoptOrSpawnOrRefuse();
      await new Promise((r) => setTimeout(r, 50));

      expect(adopted).toBe(true);
      expect(spawnCalled).toBe(false);
      expect(survivorExited).toBe(false);
      expect(endpoint.current()?.identity).toEqual({ staleKey: "survivor" });
    });

    it("with NO survivor: spawns fresh and returns false (there is nothing to refuse)", async () => {
      const d = dir();
      const socketPath = join(d, "x.sock");
      const gatePath = join(d, "x.pid"); // no gate file → no survivor
      const fake = fakeDaemon(socketPath);
      servers.push(fake.server);

      const endpoint = createEndpoint<string, Identity>({
        hostId: "local",
        home: { dir: dirname(socketPath), gatePath, socketPath },
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: { spawn: () => fake.listen() },
        connect: async (_socketPath) => ({
          client: "FRESH",
          identity: { staleKey: "fresh" },
          startedAt: 1,
          dispose() {},
          onClose() {},
        }),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
      });

      const adopted = await endpointPrivate(endpoint).adoptOrSpawnOrRefuse();
      expect(adopted.kind).not.toBe("adopted-resident");
      expect(endpoint.current()?.identity).toEqual({ staleKey: "fresh" });
    });
  },
);

describeDaemon(
  "adoptOrEnsure — the W2.2 upgrade adopt-hint (legacy port kaval)",
  () => {
    const tick = (ms = 50): Promise<void> =>
      new Promise((r) => setTimeout(r, ms));

    // A live serving survivor at rendezvous `rv`: a real `sleep` pid in the gate AND a
    // listening socket — the exact `liveServingHolder` candidate. Returns the pid and an
    // exited() flag so a recycle's SIGTERM can be observed.
    async function liveSurvivor(rv: {
      dir: string;
      gatePath: string;
      socketPath: string;
    }): Promise<{ pid: number; exited: () => boolean }> {
      const survivor = spawn("sleep", ["60"], { stdio: "ignore" });
      const pid = survivor.pid as number;
      children.push(pid);
      writeFileSync(rv.gatePath, `${pid}\n`);
      let hasExited = false;
      survivor.on("exit", () => {
        hasExited = true;
      });
      const fake = fakeDaemon(rv.socketPath);
      servers.push(fake.server);
      await fake.listen();
      return { pid, exited: () => hasExited };
    }

    function conn(
      id: string,
      startedAt = 1,
    ): DaemonConnection<string, Identity> {
      return {
        client: id,
        identity: { staleKey: id },
        startedAt,
        dispose() {},
        onClose() {},
      };
    }

    it("PRIMARY (digest) gate live → adopts the PRIMARY, NEVER probes the hint", async () => {
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      await liveSurvivor(primary);
      const legacy = await liveSurvivor(hint); // also alive — but must be IGNORED

      let hintConnectCalled = false;
      let onAdoptedCalled = false;
      let driverSpawnCalled = false;
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            driverSpawnCalled = true;
          },
        },
        connect: async (_socketPath) => conn("primary", 99),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => {
            hintConnectCalled = true;
            return conn("legacy", 5);
          },
          onAdopted: () => {
            onAdoptedCalled = true;
          },
        },
        onSpawned: () => {},
      });

      const adopted = await endpointPrivate(ep).adoptOrEnsure();
      await tick();

      expect(adopted).toBe(true);
      expect(ep.current()?.identity).toEqual({ staleKey: "primary" });
      expect(hintConnectCalled).toBe(false); // the hint is only a PRIMARY-empty fallback
      expect(onAdoptedCalled).toBe(false);
      expect(driverSpawnCalled).toBe(false);
      expect(legacy.exited()).toBe(false); // the legacy survivor is left untouched
    });

    it("PRIMARY empty + a COMPATIBLE legacy survivor at the hint → ADOPTS it, fires onAdopted, no spawn, no kill", async () => {
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      const legacy = await liveSurvivor(hint); // no primary survivor written/listening

      let onAdoptedCalled = false;
      let driverSpawnCalled = false;
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            driverSpawnCalled = true;
          },
        },
        connect: async (_socketPath) => conn("primary-fresh"),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => conn("legacy", 5),
          onAdopted: () => {
            onAdoptedCalled = true;
          },
        },
        onSpawned: () => {},
      });

      const adopted = await endpointPrivate(ep).adoptOrEnsure();
      await tick();

      expect(adopted).toBe(true);
      expect(ep.current()?.identity).toEqual({ staleKey: "legacy" }); // adopted the hint
      expect(onAdoptedCalled).toBe(true); // recorded the hint socket as the live location
      expect(driverSpawnCalled).toBe(false); // adopted, never spawned a fresh digest kaval
      expect(legacy.exited()).toBe(false); // adopted, never killed
    });

    it("PRIMARY empty + a SKEWED legacy survivor at the hint → RECYCLES it (kills the legacy holder) and spawns fresh at the PRIMARY", async () => {
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      const legacy = await liveSurvivor(hint);
      const fakePrimary = fakeDaemon(primary.socketPath);
      servers.push(fakePrimary.server);

      let driverSpawnCalled = false;
      let onSpawnedCalled = 0;
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            driverSpawnCalled = true;
            await fakePrimary.listen(); // the fresh (digest) kaval comes up
          },
        },
        connect: async (_socketPath) => conn("primary-fresh"),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
        adoptConnectRetryMs: 1,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => {
            throw skewError({
              subject: "pty-host",
              daemonVersion: "1.0",
              requiredVersion: "5.2",
            });
          },
          onAdopted: () => {},
        },
        onSpawned: () => {
          onSpawnedCalled += 1;
        },
      });

      const adopted = await endpointPrivate(ep).adoptOrEnsure();
      await tick();

      expect(adopted).toBe(false);
      expect(legacy.exited()).toBe(true); // the SKEWED legacy kaval was recycled (killed)
      expect(driverSpawnCalled).toBe(true); // fresh spawn — at the PRIMARY (digest), not the hint
      expect(ep.current()?.identity).toEqual({ staleKey: "primary-fresh" });
      expect(onSpawnedCalled).toBe(1);
    });

    it("hint-adopt SKEW → recycle → the fresh PRIMARY spawn ALSO skews: the primary rendezvous is still committed (onSpawned fired), status is incompatible", async () => {
      // The F1 ordering pin (codex round 1): committing `held = primaryRv` +
      // `onSpawned` must happen when the primary socket comes UP, BEFORE the
      // handshake — otherwise a skewing fresh spawn leaves the endpoint holding
      // the recycled hint's DEAD legacy rendezvous (a later recycle probes the
      // wrong holder; padi's status carries the dead legacy socket) and the
      // caller's hint-reset never fires.
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      const legacy = await liveSurvivor(hint);
      const fakePrimary = fakeDaemon(primary.socketPath);
      servers.push(fakePrimary.server);

      let onSpawnedCalled = 0;
      const statuses: EndpointStatus<Identity>[] = [];
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            await fakePrimary.listen();
          },
        },
        // The PRIMARY handshake skews too — the whole closure on this host is
        // incompatible, whoever runs it.
        connect: async (_socketPath) => {
          throw skewError({
            subject: "pty-host",
            daemonVersion: "1.0",
            requiredVersion: "5.2",
          });
        },
        log: silentLog,
        onStatus: (_h, st) => statuses.push(st),
        socketPollMs: 5,
        adoptConnectRetryMs: 1,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => {
            throw skewError({
              subject: "pty-host",
              daemonVersion: "1.0",
              requiredVersion: "5.2",
            });
          },
          onAdopted: () => {},
        },
        onSpawned: () => {
          onSpawnedCalled += 1;
        },
      });

      await expect(endpointPrivate(ep).adoptOrEnsure()).rejects.toMatchObject({
        isContractSkew: true,
      });
      await tick();

      expect(legacy.exited()).toBe(true); // the skewed hint survivor was recycled
      // The rendezvous commit + hint reset happened DESPITE the failed handshake:
      // the primary socket is up and the daemon there is the held one now.
      expect(onSpawnedCalled).toBe(1);
      expect(statuses.at(-1)?.state).toBe("incompatible");
    });

    it("PRIMARY empty + NO live survivor at the hint → spawns fresh at the PRIMARY (never probes the dead hint)", async () => {
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      const fakePrimary = fakeDaemon(primary.socketPath);
      servers.push(fakePrimary.server);

      let hintConnectCalled = false;
      let onAdoptedCalled = false;
      let onSpawnedCalled = 0;
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: { spawn: () => fakePrimary.listen() },
        connect: async (_socketPath) => conn("primary-fresh"),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => {
            hintConnectCalled = true;
            return conn("legacy");
          },
          onAdopted: () => {
            onAdoptedCalled = true;
          },
        },
        onSpawned: () => {
          onSpawnedCalled += 1;
        },
      });

      const adopted = await endpointPrivate(ep).adoptOrEnsure();
      expect(adopted.kind).not.toBe("adopted-resident");
      expect(ep.current()?.identity).toEqual({ staleKey: "primary-fresh" });
      expect(hintConnectCalled).toBe(false); // no live daemon at the hint gate to connect to
      expect(onAdoptedCalled).toBe(false);
      expect(onSpawnedCalled).toBe(1);
    });

    it("CONVERGENCE: a recycle AFTER a hint adoption kills the adopted legacy kaval and respawns at the PRIMARY (digest)", async () => {
      const d = dir();
      const primary = {
        dir: d,
        gatePath: join(d, "p.pid"),
        socketPath: join(d, "p.sock"),
      };
      const hint = {
        dir: d,
        gatePath: join(d, "l.pid"),
        socketPath: join(d, "l.sock"),
      };
      const legacy = await liveSurvivor(hint);
      const fakePrimary = fakeDaemon(primary.socketPath);
      servers.push(fakePrimary.server);

      let driverSpawnCalled = 0;
      let onSpawnedCalled = 0;
      let onAdoptedCalled = false;
      const ep = createEndpoint<string, Identity>({
        hostId: "local",
        home: primary,
        policy: {
          capability: "not-drainable",
          baked: {
            contractVersion: "test",
            build: { kind: "known", id: "test-build" },
          },
          onContractSkew: { kind: "recycle" },
          onBuildMismatch: { kind: "nudge-human" },
        },
        probe: async () => null,
        driver: {
          spawn: async () => {
            driverSpawnCalled += 1;
            await fakePrimary.listen();
          },
        },
        connect: async (_socketPath) => conn("primary-fresh", 42),
        log: silentLog,
        onStatus: () => {},
        socketPollMs: 5,
        adoptHint: {
          home: hint,
          connect: async (_socketPath) => conn("legacy", 5),
          onAdopted: () => {
            onAdoptedCalled = true;
          },
        },
        onSpawned: () => {
          onSpawnedCalled += 1;
        },
      });

      // Boot: no digest survivor, adopt the legacy hint.
      const adopted = await endpointPrivate(ep).adoptOrEnsure();
      expect(adopted.kind).toBe("adopted-resident");
      expect(ep.current()?.identity).toEqual({ staleKey: "legacy" });
      expect(onAdoptedCalled).toBe(true);
      expect(driverSpawnCalled).toBe(0); // adopted, never spawned

      // A Restart-kaval recycle (`ensure()`) probes the HELD rendezvous — the adopted
      // legacy socket, not the primary — so it SIGTERMs the legacy daemon and spawns
      // fresh at the PRIMARY (digest). The bounded migration converges here.
      await endpointPrivate(ep).ensure();
      await tick();

      expect(legacy.exited()).toBe(true); // the adopted legacy kaval was killed by the recycle
      expect(driverSpawnCalled).toBe(1); // respawned at the primary (digest)
      expect(ep.current()?.identity).toEqual({ staleKey: "primary-fresh" });
      expect(onSpawnedCalled).toBe(1); // the spawn reset the recorded location to the primary
    });
  },
);
