/**
 * Serve a top-level pty-host router over a unix-domain socket — the socket link
 * the in-process header promises ("Reused over a socket by the surviving
 * daemon"). kolu-server uses it for R-4 Phase 1 (so `kolu-tui` can reach the
 * live PTYs); Phase B's standalone daemon reuses it unchanged.
 *
 * The caller passes the contract-wrapped router (`createInProcessPtyHost`'s
 * `servedRouter`) — the fragment→top-level wrap lives at host construction, so
 * this helper is pure socket-transport lifecycle: probe, listen, accept, serve,
 * close, with no knowledge of the contract. A `net.Socket` is a Duplex, so it IS
 * the `{ read, write }` transport `serveOverStdio` wants — each accepted
 * connection gets its own peer over the same base64+newline framing as the
 * ssh/subprocess path. The router is shared across connections (and with the
 * in-process `directLink` client); there is no per-connection state coupling.
 */
import { mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname } from "node:path";
import { serveOverStdio } from "@kolu/surface/peer-server";
import type { Router } from "@orpc/server";
import type { Logger } from "kolu-shared";

export interface PtyHostSocketListener {
  /** The path the socket is bound to (or that a live peer already owns). */
  readonly socketPath: string;
  /** Stop accepting connections and remove the socket file. Idempotent and
   *  safe to call synchronously from a `process.on("exit")` handler. */
  close(): void;
}

/** Does a live peer already serve a socket at `path`? Resolves true if a
 *  connection is accepted, false on ECONNREFUSED / ENOENT (a stale file left
 *  by a crash, or nothing there). */
function isSocketLive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection(path);
    const settle = (live: boolean): void => {
      probe.destroy();
      resolve(live);
    };
    probe.once("connect", () => settle(true));
    probe.once("error", () => settle(false));
  });
}

/** Start serving `router` over a unix socket at `socketPath`. Returns a
 *  listener whose `close()` stops it and removes the socket file.
 *
 *  The socket is an *additive* convenience — it's how `kolu-tui` reaches the
 *  pty-host — and kolu-server's web path is entirely independent of it, so a
 *  failure to bind it must NEVER crash the server. Every failure mode resolves
 *  to a no-op listener with a warning, not a rejection: a live peer already on
 *  the path (the single-server model — don't hijack its CLI clients), a lost
 *  race for the path (`EADDRINUSE` when parallel instances share the default
 *  socket, as the e2e harness does), or an unwritable dir. Pass
 *  `--pty-host-socket` to give each instance its own path. */
export async function servePtyHostOverUnixSocket(opts: {
  socketPath: string;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param.
  router: Router<any, any>;
  log?: Logger;
}): Promise<PtyHostSocketListener> {
  const { socketPath, router, log } = opts;
  const noop: PtyHostSocketListener = { socketPath, close() {} };

  try {
    // Owner-only parent dir, mirroring koluRoot's 0o700 privacy.
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });

    if (await isSocketLive(socketPath)) {
      log?.warn(
        { socketPath },
        "pty-host socket already served by another kolu instance; not taking it over (kolu-tui reaches that one). Use --pty-host-socket to run a second instance.",
      );
      return noop;
    }
    // Stale file from a crash (or nothing): clear it so listen() won't EADDRINUSE.
    rmSync(socketPath, { force: true });

    const server = createServer((socket) => {
      // A client vanishing mid-frame must not take down the listener — log at
      // debug and let serveOverStdio's read-stream-end resolve that peer.
      socket.on("error", (err) =>
        log?.debug({ err }, "pty-host socket client error"),
      );
      void serveOverStdio({
        router,
        transport: { read: socket, write: socket },
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    log?.info({ socketPath }, "pty-host socket listening (kolu-tui)");
    server.on("error", (err) =>
      log?.error({ err }, "pty-host socket server error"),
    );

    let closed = false;
    return {
      socketPath,
      close() {
        if (closed) return;
        closed = true;
        log?.info({ socketPath }, "pty-host socket closed");
        server.close();
        rmSync(socketPath, { force: true });
      },
    };
  } catch (err) {
    // Most often EADDRINUSE: another instance won the race for this path. Degrade
    // to no kolu-tui socket this run rather than take the server down with us.
    log?.warn(
      { err, socketPath },
      "pty-host socket unavailable this run (could not bind); kolu-server otherwise unaffected",
    );
    return noop;
  }
}
