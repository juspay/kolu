/**
 * Unix-socket transport — the local-IPC member of the link family. The
 * server half (`serveOverUnixSocket`) accepts connections and pumps each one
 * through `serveOverStdio` (a `net.Socket` is a Duplex, so it IS the
 * `{ read, write }` transport the stdio framing wants); the client half is
 * `unixSocketLink` in `./links/unix-socket`. Same base64+newline framing as
 * the subprocess/ssh path — only the stream pair differs.
 *
 * Also home to `getRuntimeSocketPath`, the per-user rendezvous-path
 * convention the two halves share: server and client are separate processes,
 * so they must compute the SAME path with no coordination beyond the app
 * name. See its doc for why `os.tmpdir()` is the wrong tool for that.
 *
 * Serving is hardened to be *additive*: every failure mode resolves to a
 * no-op listener with a machine-readable `outcome`, never a rejection — a
 * host process whose unix socket is a convenience must not crash because the
 * path was taken, unprobeable, or unwritable. The caller inspects `outcome`
 * and logs app-flavored advice (which flag to pass, what the path means);
 * this module owns only the transport verdicts.
 */
import { lstatSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { dirname, join } from "node:path";
import type { Router } from "@orpc/server";
import { serveOverStdio } from "./peer-server";

/** Minimal structured-logging shape this module accepts — structurally
 *  compatible with pino child loggers and kolu's `Logger`, so callers pass
 *  theirs straight in. Used only for *runtime* events after a successful
 *  bind (a client socket error, a peer dying mid-frame, a listener error);
 *  bind-time verdicts are reported via `UnixSocketServeOutcome` instead so
 *  the caller owns the user-facing copy. */
export type UnixSocketLogger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/** The per-user rendezvous path for a unix socket two separate processes of
 *  the same app must both compute — `override` verbatim when given (an empty
 *  string counts as absent), else `$XDG_RUNTIME_DIR/<app>/<file>` on systemd
 *  Linux, else the fixed per-user `/tmp/<app>-$UID/<file>`.
 *
 *  Why a STABLE path: the connecting process must find the serving one
 *  *without* knowing anything about it beyond the app name. A fixed path is
 *  the discoverable Unix convention (cf. D-Bus's `/run/user/$UID/bus`,
 *  tmux's `/tmp/tmux-$UID/`, X11's `/tmp/.X11-unix`).
 *
 *  Why NOT `os.tmpdir()` for the fallback: it honours `$TMPDIR`, which
 *  differs by launch context — on macOS a launchd-spawned server gets a
 *  private `/var/folders/.../T` while a `nix run` CLI gets `/tmp` — so the
 *  two processes would land on *different* sockets and never meet. `/tmp` is
 *  always present and identical in every process on Linux and macOS, and the
 *  `-$UID` suffix keeps it per-user (`serveOverUnixSocket` creates the dir
 *  `0700` and refuses to serve unless it stays owner-only). The `"shared"`
 *  suffix is an unreachable fallback for platforms without uid semantics. */
export function getRuntimeSocketPath(opts: {
  /** App namespace — the directory component (`<app>/` under XDG, `/tmp/<app>-$UID/` off it). */
  app: string;
  /** Socket filename within the app dir, e.g. `"pty-host.sock"`. */
  file: string;
  /** Explicit user-supplied path (a CLI flag); returned verbatim when non-empty. */
  override?: string;
}): string {
  if (opts.override !== undefined && opts.override !== "") {
    return opts.override;
  }
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg !== undefined && xdg !== "") {
    return join(xdg, opts.app, opts.file);
  }
  const uid = process.getuid?.() ?? "shared";
  return join(`/tmp/${opts.app}-${uid}`, opts.file);
}

/** Is `dir` a private, owner-only directory the current user owns? Directory
 *  privacy is the security boundary for whatever the socket serves — anyone
 *  who can `connect()` gets the full router. The danger is a STABLE shared
 *  path (`/tmp/<app>-$UID`) on a multi-user host: another local user could
 *  pre-create it with loose perms before we do, and `mkdirSync` does NOT
 *  repair an existing dir's owner/mode. So after creating it we VERIFY:
 *  current-uid owned and no group/other access bit. Returns true on
 *  platforms without uid semantics (Windows: `process.getuid` is undefined)
 *  — the ACL model there is out of scope for this check. */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  const st = statSync(dir);
  return st.uid === getuid() && (st.mode & 0o077) === 0;
}

/** What a `connect()` probe of the socket path tells us about who, if anyone,
 *  is on the other end — a three-way verdict, NOT a boolean, because the
 *  caller must treat "nobody's there, clear the stale inode" and "I couldn't
 *  tell" differently. Collapsing both to `false` is a data-loss footgun: it
 *  would unlink a socket we merely failed to probe (e.g. EACCES) as if it
 *  were a dead peer's leftover. */
type SocketProbe =
  /** A peer accepted the connection — the path is in active use; never touch it. */
  | { kind: "live" }
  /** The path is free to bind: either nothing is there (ENOENT — the common
   *  fresh-start case) or a real socket inode exists with no listener
   *  (ECONNREFUSED — the stale file a crashed peer left behind). The caller
   *  may `rmSync` to clear it, but ONLY after confirming the inode is a
   *  socket (or already gone) — never the user's regular file at a
   *  stale-looking path. */
  | { kind: "stale" }
  /** Any other connect error (EACCES, EPERM, ENOTSOCK on a regular file, …).
   *  We don't know what's there, so we refuse to delete and degrade to a
   *  no-op. */
  | { kind: "unknown"; code?: string };

/** ECONNREFUSED (dead socket inode) and ENOENT (nothing there) are the only
 *  two errors that mean "safe to bind here" — everything else is unknown. */
const FREE_TO_BIND = new Set(["ECONNREFUSED", "ENOENT"]);

function probeSocket(path: string): Promise<SocketProbe> {
  return new Promise((resolve) => {
    const probe = createConnection(path);
    const settle = (result: SocketProbe): void => {
      probe.destroy();
      resolve(result);
    };
    probe.once("connect", () => settle({ kind: "live" }));
    probe.once("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      settle(
        code !== undefined && FREE_TO_BIND.has(code)
          ? { kind: "stale" }
          : { kind: "unknown", code },
      );
    });
  });
}

/** Is the inode at `path` an actual socket file? `lstat` (not `stat`) so a
 *  symlink is classified as itself and left intact rather than followed to
 *  its target. ENOENT (nothing there) counts as "removable" too — a no-op
 *  `rmSync`. Pairs with a `stale` probe verdict: we only unlink when BOTH
 *  agree the path is a dead socket inode, never on a probe error against an
 *  unknown inode. */
function isSocketInodeOrAbsent(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** How a `serveOverUnixSocket` call resolved. Exactly one outcome is
 *  `listening`; every other kind is a refusal that resolved to a no-op
 *  listener (close() does nothing) — the caller logs app-appropriate advice
 *  per kind. */
export type UnixSocketServeOutcome =
  /** Bound and accepting connections. */
  | { kind: "listening" }
  /** The socket's parent dir is not an owner-only dir we own — serving there
   *  would expose the full router to other local users. */
  | { kind: "dir-not-private"; dir: string }
  /** A live peer already owns the path (another instance of the app). */
  | { kind: "already-served" }
  /** The probe failed with something other than a clean "stale" verdict
   *  (EACCES, EPERM, …) — we could not prove the path dead, so we refuse to
   *  remove it. */
  | { kind: "probe-failed"; code?: string }
  /** The path exists but is not a socket inode (a regular file, dir, or
   *  symlink) — deleting it would destroy user data. */
  | { kind: "not-a-socket" }
  /** mkdir/listen threw — most often EADDRINUSE when parallel instances race
   *  for the same path. */
  | { kind: "bind-failed"; err: unknown };

export interface UnixSocketListener {
  /** The path the socket is bound to (or that the refusal was about). */
  readonly socketPath: string;
  /** Why this listener is (or is not) serving. */
  readonly outcome: UnixSocketServeOutcome;
  /** Stop accepting connections and remove the socket file. Idempotent, a
   *  no-op on a non-`listening` outcome, and safe to call synchronously from
   *  a `process.on("exit")` handler. */
  close(): void;
}

/** Serve `router` over a unix socket at `socketPath`. NEVER rejects and
 *  never throws — every failure mode resolves to a no-op listener whose
 *  `outcome` says why, so a host process can treat the socket as purely
 *  additive. The flow: create the parent dir `0700` → verify it's private →
 *  probe the path for a live peer → clear a provably-stale socket inode
 *  (and only that) → listen. Each accepted connection is served
 *  independently over the stdio framing; the router is shared across
 *  connections. */
export async function serveOverUnixSocket(opts: {
  socketPath: string;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverStdio's own `Router<any, Context>` param.
  router: Router<any, any>;
  /** Runtime-event logging only (client socket errors, peer mid-frame
   *  deaths, post-listen listener errors). Bind-time verdicts arrive via
   *  `outcome` instead. */
  log?: UnixSocketLogger;
}): Promise<UnixSocketListener> {
  const { socketPath, router, log } = opts;
  const refused = (outcome: UnixSocketServeOutcome): UnixSocketListener => ({
    socketPath,
    outcome,
    close() {},
  });

  try {
    const dir = dirname(socketPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // mkdirSync's mode is a no-op on a PRE-EXISTING dir, so verify privacy
    // rather than assume it — a stable path another user could have
    // pre-created with loose perms must not host a full-control router.
    if (!isPrivateOwnedDir(dir)) {
      return refused({ kind: "dir-not-private", dir });
    }

    const probe = await probeSocket(socketPath);
    if (probe.kind === "live") {
      return refused({ kind: "already-served" });
    }
    if (probe.kind === "unknown") {
      return refused({ kind: "probe-failed", code: probe.code });
    }
    // probe.kind === "stale": ECONNREFUSED (a crashed peer's leftover inode)
    // or ENOENT (nothing there — the fresh-start case). Clear the path so
    // listen() won't EADDRINUSE, but ONLY if the inode is actually a socket
    // (or already gone): an arbitrary user-supplied path pointed at a
    // regular file/dir/symlink must refuse, never silently unlink data.
    if (!isSocketInodeOrAbsent(socketPath)) {
      return refused({ kind: "not-a-socket" });
    }
    rmSync(socketPath, { force: true });

    const server = createServer((socket) => {
      // A client vanishing mid-frame must not take down the listener.
      socket.on("error", (err) =>
        log?.debug({ err }, "unix-socket client error"),
      );
      // serveOverStdio never rejects — it resolves with how serving ended,
      // so a peer dying mid-frame is a debug line, not an unhandled
      // rejection (see peer-server.ts).
      void serveOverStdio({
        router,
        transport: { read: socket, write: socket },
      }).then((end) => {
        if (end.reason === "error") {
          log?.debug(
            { err: end.error },
            "unix-socket peer ended with an error",
          );
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (err) => log?.error({ err }, "unix-socket server error"));

    let closed = false;
    return {
      socketPath,
      outcome: { kind: "listening" },
      close() {
        if (closed) return;
        closed = true;
        server.close();
        rmSync(socketPath, { force: true });
      },
    };
  } catch (err) {
    // Most often EADDRINUSE: another instance won the race for this path.
    return refused({ kind: "bind-failed", err });
  }
}
