/**
 * Unit tests for the `--stdio` bridge — the byte relay that fronts the durable
 * daemon over an ssh stdio link. A real `net` server stands in for the daemon's
 * socket; `connect`/`spawnDaemon` are injected so nothing forks a process or
 * touches the well-known path. The relay is transport-blind (it splices bytes),
 * so an echo server is enough to prove both directions and the link lifecycle.
 */
import { createConnection, createServer, type Server, Socket } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runStdioBridge } from "./stdioBridge.ts";

const servers: Server[] = [];

/** An echo server on a fresh unix socket — bytes in are bytes out, so a relay
 *  test can assert the daemon→client direction by what it sent client→daemon. */
function echoServer(): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "kaval-bridge-")), "d.sock");
  const server = createServer((conn) => conn.pipe(conn));
  servers.push(server);
  return new Promise((resolve) => server.listen(path, () => resolve(path)));
}

/** A Writable that accumulates everything the bridge paints to "stdout". */
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

describe("runStdioBridge", () => {
  it("fronts an already-running daemon: relays both directions, never spawns", async () => {
    const sockPath = await echoServer();
    const stdin = new PassThrough();
    const out = captureStdout();
    let spawned = 0;

    const done = runStdioBridge({
      socketOverride: "/unused-in-test",
      stdin,
      stdout: out.stream,
      connect: () => createConnection(sockPath),
      spawnDaemon: () => {
        spawned += 1;
      },
      log: () => {},
    });

    // client → daemon → (echo) → client lands on our stdout.
    stdin.write("PING-42");
    await until(() => out.text().includes("PING-42"), "echoed bytes");
    expect(spawned).toBe(0); // a live daemon is fronted, not respawned

    // The ssh peer closing its input ends the link; the bridge resolves.
    stdin.end();
    await done;
  });

  it("starts a daemon when none is listening, then connects once its socket binds", async () => {
    const sockPath = join(
      mkdtempSync(join(tmpdir(), "kaval-bridge-")),
      "d.sock",
    );
    const stdin = new PassThrough();
    const out = captureStdout();
    let spawned = 0;

    const done = runStdioBridge({
      socketOverride: "/unused-in-test",
      stdin,
      stdout: out.stream,
      connect: () => createConnection(sockPath),
      // The "daemon" only comes up when the bridge asks for it — exactly the
      // fresh-remote case where the first `--host` link must start kaval.
      spawnDaemon: () => {
        spawned += 1;
        const server = createServer((conn) => conn.pipe(conn));
        servers.push(server);
        server.listen(sockPath);
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
    // fault), NOT "no daemon yet". The bridge must propagate that real error
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
      runStdioBridge({
        socketOverride: "/unused-in-test",
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
    const path = join(mkdtempSync(join(tmpdir(), "kaval-bridge-")), "d.sock");

    // A daemon that accepts then immediately closes its side of the connection.
    let serverConn: import("node:net").Socket | undefined;
    const server = createServer((conn) => {
      serverConn = conn;
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(path, r));

    const done = runStdioBridge({
      socketOverride: "/unused-in-test",
      stdin,
      stdout: out.stream,
      connect: () => createConnection(path),
      spawnDaemon: () => {},
      log: () => {},
    });

    await until(() => serverConn !== undefined, "server-side connection");
    serverConn?.end(); // daemon-side close ends the bridge too
    await done;
    expect(out.text()).toBe(""); // a clean teardown, nothing painted
  });
});
