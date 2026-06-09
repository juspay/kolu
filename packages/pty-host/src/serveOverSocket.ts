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
import { lstatSync, mkdirSync, rmSync, statSync } from "node:fs";
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

/** Is `dir` a private, owner-only directory the current user owns? The socket
 *  serves the FULL `ptyHostSurface` (write/kill/spawn/getScreenText), so
 *  directory privacy is the security boundary — anyone who can `connect()` the
 *  socket drives every PTY. On systemd Linux the parent is `$XDG_RUNTIME_DIR`
 *  (`/run/user/$UID`, tmpfs 0700) and is safe. The danger is the off-systemd
 *  `/tmp/kolu-$UID` fallback on a shared host: the path is STABLE (it must be,
 *  so the CLI finds it without the server's UUID — unlike koluRoot's
 *  `kolu-<uuid>`), so another local user could pre-create `/tmp/kolu-$UID`
 *  with loose perms before we do, and our `mkdirSync` does NOT repair an
 *  existing dir's owner/mode. So after creating it we VERIFY: current-uid owned
 *  and no group/other access. A failure returns false → refuse to bind (the
 *  caller degrades to a no-op listener with a warning), never serve a powerful
 *  surface from a directory someone else can reach into.
 *
 *  Returns true on platforms without uid semantics (Windows: `process.getuid`
 *  is undefined) — the ACL model there is out of scope for this check. */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  const st = statSync(dir);
  // Owner must be us, and neither group nor other may have any access bit
  // (mode & 0o077 === 0) — the same 0o700 privacy koluRoot relies on.
  return st.uid === getuid() && (st.mode & 0o077) === 0;
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

/** Is `path` safe to `rmSync` so `listen()` can bind it? Only a *socket* file
 *  (or nothing) is — a dead peer leaves a stale socket inode behind, and that's
 *  the one thing we may clear. Anything else (a regular file, a directory, a
 *  symlink) is NOT ours to delete: `--pty-host-socket` is an arbitrary
 *  user-supplied path, so pointing it at an existing regular file must warn and
 *  refuse, never silently unlink the user's data. `lstat` (not `stat`) so a
 *  symlink at the path is itself classified as a non-socket and left intact
 *  rather than followed to its target. ENOENT (nothing there) is the common,
 *  expected case → safe to "remove" (a no-op `rmSync`). Any other probe error
 *  (EACCES, …) is treated as not-removable: fail soft rather than guess. */
function isRemovableStaleSocket(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
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
    const dir = dirname(socketPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // mkdirSync's mode is a no-op on a PRE-EXISTING dir, so verify privacy
    // rather than assume it — a stable `/tmp/kolu` path another user could have
    // pre-created with loose perms must not host this full-control surface.
    if (!isPrivateOwnedDir(dir)) {
      log?.warn(
        { socketPath, dir },
        "pty-host socket dir is not a private owner-only directory; refusing to serve the pty-host there (it grants full PTY control). Use --pty-host-socket to point at a directory you own with 0700 perms.",
      );
      return noop;
    }

    if (await isSocketLive(socketPath)) {
      log?.warn(
        { socketPath },
        "pty-host socket already served by another kolu instance; not taking it over (kolu-tui reaches that one). Use --pty-host-socket to run a second instance.",
      );
      return noop;
    }
    // A dead peer leaves a stale SOCKET inode; clear only that so listen()
    // won't EADDRINUSE. Refuse if the path is a regular file/dir/symlink — an
    // arbitrary `--pty-host-socket` could point at the user's own data, and
    // unlinking it would be data loss, not stale-socket cleanup.
    if (!isRemovableStaleSocket(socketPath)) {
      log?.warn(
        { socketPath },
        "pty-host socket path exists and is not a socket (a regular file, dir, or symlink); refusing to remove it. Use --pty-host-socket to point at a free path.",
      );
      return noop;
    }
    rmSync(socketPath, { force: true });

    const server = createServer((socket) => {
      // A client vanishing mid-frame must not take down the listener — log at
      // debug and let serveOverStdio's read-stream-end resolve that peer.
      socket.on("error", (err) =>
        log?.debug({ err }, "pty-host socket client error"),
      );
      // serveOverStdio returns `readFramedLines`' promise, which REJECTS when
      // the read stream errors (a peer reset / aborted mid-frame). It MUST be
      // caught: kolu-server treats unhandled rejections as fatal
      // (`process.exit(1)`), so a flaky local CLI client would otherwise take
      // the whole server down — exactly what this listener promises it won't.
      serveOverStdio({
        router,
        transport: { read: socket, write: socket },
      }).catch((err) =>
        log?.debug({ err }, "pty-host socket peer ended with an error"),
      );
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
