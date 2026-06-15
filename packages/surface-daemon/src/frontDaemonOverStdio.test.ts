/**
 * Unit tests for `frontDaemonOverStdio` — the byte relay that fronts a durable
 * surface daemon over a stdio link. A real `net` server stands in for the
 * daemon's socket; `spawnDaemon`/`connect` are injected so nothing forks a
 * process or touches a well-known path. The relay is transport-blind (it splices
 * bytes), so an echo server is enough to prove both directions and the link
 * lifecycle. A separate block pins `reExecAsDetachedDaemon`'s spawn shape with an
 * injected `spawn` — the load-bearing single-process re-exec invariant.
 */
import { mkdtempSync } from "node:fs";
import { createServer, type Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  frontDaemonOverStdio,
  reExecAsDetachedDaemon,
} from "./frontDaemonOverStdio.ts";

const servers: Server[] = [];

/** An echo server on a fresh unix socket — bytes in are bytes out, so a relay
 *  test can assert the daemon→client direction by what it sent client→daemon. */
function echoServer(): Promise<string> {
  const path = freshSocketPath();
  const server = createServer((conn) => conn.pipe(conn));
  servers.push(server);
  return new Promise((resolve) => server.listen(path, () => resolve(path)));
}

/** A unique unix-socket path under a fresh temp dir — nothing listening on it. */
function freshSocketPath(): string {
  return join(mkdtempSync(join(tmpdir(), "front-daemon-")), "d.sock");
}

/** A Writable that accumulates everything the front paints to "stdout". */
function captureStdout(): { stream: Writable; text(): string } {
  let text = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => text };
}

const until = async (cond: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("frontDaemonOverStdio", () => {
  it("fronts an already-running daemon: relays both directions, never spawns", async () => {
    const socketPath = await echoServer();
    const stdin = new PassThrough();
    const out = captureStdout();
    let spawned = 0;

    const done = frontDaemonOverStdio({
      socketPath,
      stdin,
      stdout: out.stream,
      spawnDaemon: () => {
        spawned += 1;
      },
      log: () => {},
    });

    // client → daemon → (echo) → client lands on our stdout.
    stdin.write("PING-42");
    await until(() => out.text().includes("PING-42"), "echoed bytes");
    expect(spawned).toBe(0); // a live daemon is fronted, not respawned

    // The peer closing its input ends the link; the front resolves.
    stdin.end();
    await done;
  });

  it("starts a daemon when none is listening, then connects once its socket binds", async () => {
    const socketPath = freshSocketPath();
    const stdin = new PassThrough();
    const out = captureStdout();
    let spawned = 0;

    const done = frontDaemonOverStdio({
      socketPath,
      stdin,
      stdout: out.stream,
      // The "daemon" only comes up when the front asks for it — exactly the
      // fresh-remote case where the first link must start it.
      spawnDaemon: () => {
        spawned += 1;
        const server = createServer((conn) => conn.pipe(conn));
        servers.push(server);
        server.listen(socketPath);
      },
      pollMs: 20,
      log: () => {},
    });

    stdin.write("HELLO");
    await until(() => out.text().includes("HELLO"), "echo after spawn");
    expect(spawned).toBe(1);

    stdin.end();
    await done;
  });

  it("surfaces a non-retryable connect error instead of spawning + timing out", async () => {
    // EACCES/ENOTSOCK/… mean the path is unprobeable (a perms or not-a-socket
    // fault), NOT "no daemon yet". The front must propagate that real error
    // immediately, never read it as absence — which would start a daemon, wait
    // the full deadline, and then report a misleading timeout.
    const stdin = new PassThrough();
    const out = captureStdout();
    let spawned = 0;

    const failing = (): Socket => {
      const socket = new Socket();
      // No connect; emit a non-retryable code on the next tick.
      queueMicrotask(() => {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        socket.emit("error", err);
      });
      return socket;
    };

    await expect(
      frontDaemonOverStdio({
        socketPath: "/unprobeable.sock",
        stdin,
        stdout: out.stream,
        connect: failing,
        spawnDaemon: () => {
          spawned += 1;
        },
        daemonWaitMs: 50,
        pollMs: 10,
        log: () => {},
      }),
    ).rejects.toThrow(/EACCES|permission denied/);
    // It failed fast on the real error — never started a daemon to wait on.
    expect(spawned).toBe(0);
  });

  it("ends the link when the daemon drops the connection", async () => {
    const stdin = new PassThrough();
    const out = captureStdout();
    const socketPath = freshSocketPath();

    // A daemon that accepts then immediately closes its side of the connection.
    let serverConn: Socket | undefined;
    const server = createServer((conn) => {
      serverConn = conn;
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(socketPath, r));

    const done = frontDaemonOverStdio({
      socketPath,
      stdin,
      stdout: out.stream,
      spawnDaemon: () => {},
      log: () => {},
    });

    await until(() => serverConn !== undefined, "server-side connection");
    serverConn?.end(); // daemon-side close ends the front too
    await done;
    expect(out.text()).toBe(""); // a clean teardown, nothing painted
  });
});

describe("reExecAsDetachedDaemon", () => {
  it("re-execs the single-process node form, detached, minus the front flag", () => {
    const calls: Array<{
      cmd: string;
      args: readonly string[];
      opts: { detached?: boolean; stdio?: unknown; env?: NodeJS.ProcessEnv };
    }> = [];
    let unrefed = 0;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal ChildProcess stub.
    const fakeSpawn = ((cmd: string, args: readonly string[], opts: any) => {
      calls.push({ cmd, args, opts });
      return {
        unref: () => {
          unrefed += 1;
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: matching node:child_process spawn's type.
    }) as any;

    const savedArgv = process.argv;
    // A front invocation: `node <execArgv…> bin.ts --stdio --socket /s`.
    process.argv = [
      process.execPath,
      "/path/bin.ts",
      "--stdio",
      "--socket",
      "/s",
    ];
    try {
      reExecAsDetachedDaemon({
        stripArgs: ["--stdio"],
        spawn: fakeSpawn,
        env: { FOO: "bar" } as NodeJS.ProcessEnv,
      });
    } finally {
      process.argv = savedArgv;
    }

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error("spawn was not called");
    const { cmd, args, opts } = call;
    // Same runtime; execArgv (the --import loader flags) preserved as the prefix;
    // the front flag stripped, every other arg kept → daemon mode.
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([
      ...process.execArgv,
      "/path/bin.ts",
      "--socket",
      "/s",
    ]);
    expect(args).not.toContain("--stdio");
    // Detached + ignore-stdio + unref → survives the SIGHUP that closes the link.
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe("ignore");
    expect(opts.env).toEqual({ FOO: "bar" });
    expect(unrefed).toBe(1);
  });
});
