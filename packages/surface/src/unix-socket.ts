/**
 * Unix-socket transport — the local-IPC member of the link family. The server
 * half (`serveOverUnixSocket`) binds the path and serves each accepted
 * connection with its own `RpcServer` over the shared handlers; the client half
 * is `unixSocketLink` in `./links/unix-socket`. Same ndjson frames as the
 * subprocess/ssh path — only the transport differs, which is what makes a
 * daemon's contract-blind stdio↔socket byte splice legal (review #10).
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
import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import type { Logger } from "@kolu/log";
import { Effect, Exit, Layer, Scope } from "effect";
import { SocketServer } from "effect/unstable/socket";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcServer } from "effect/unstable/rpc";
import { type FaceExposure, restrictHandlers } from "./expose";
import { rpcSerializationLayer } from "./frameLimit";
import { type SurfaceHandlers, surfaceRpcServerLayer } from "./server";

// The LISTENER-LIFETIME log seam (juspay/kolu#2101 N3). It is REQUIRED, not
// `log?:` as master had it: a listening socket that faults with nobody watching
// is the exact silence the #2101 field incident was made of — a comatose kaval
// that logged zero error or warn lines for its whole life — and an optional
// logger is a knob whose default is that silence. Callers all have a logger in
// scope at this call (`daemonMain`, kaval's socket voice), so requiring it costs
// nothing and removes the way to opt out.
//
// What travels here vs. what the CALLER owns: this seam narrates the LISTENER's
// own lifetime — bound, post-listen fault, closed — because only this module
// ever sees those events. BIND-time verdicts stay the caller's: they are
// `UnixSocketServeOutcome` values, and the app-flavored advice for each ("use
// --pty-host-socket") is not this module's vocabulary.

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
  /**
   * Pure multi-regime evaluation for discovery — never mutates `process.env`:
   *   - omitted — read live `$XDG_RUNTIME_DIR` (binder default)
   *   - `null` — force the `/tmp/<app>-$UID` branch
   *   - non-empty string — use this value as `$XDG_RUNTIME_DIR`
   * An explicit empty string is treated as absent (same as override).
   */
  xdgRuntimeDir?: string | null;
}): string {
  if (opts.override !== undefined && opts.override !== "") {
    return opts.override;
  }
  const xdg =
    opts.xdgRuntimeDir === null
      ? undefined
      : opts.xdgRuntimeDir !== undefined
        ? opts.xdgRuntimeDir === ""
          ? undefined
          : opts.xdgRuntimeDir
        : process.env.XDG_RUNTIME_DIR;
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
 *  pre-create it before we do, and `mkdirSync` does NOT repair an existing
 *  dir's owner/mode. So after creating it we VERIFY: current-uid owned and no
 *  group/other access bit.
 *
 *  `lstatSync` (NOT `statSync`) so a SYMLINK is judged as itself and rejected,
 *  never followed. A `statSync` here would follow the link to its target: an
 *  attacker could pre-create `/tmp/<app>-$UID` as a symlink to any owner-
 *  private directory, sail past the perm check, yet still own the `/tmp` path
 *  component — letting them later swap the link to redirect future clients to
 *  a socket of their choosing. We require a real directory the current uid
 *  owns with no group/other bits; a symlink (or any non-dir inode) fails
 *  `isDirectory()`. Returns true on platforms without uid semantics (Windows:
 *  `process.getuid` is undefined) — the ACL model there is out of scope.
 *
 *  Exported for a consumer that must make the same privacy judgement about a
 *  directory it did not create — olai's vault lock is the first. The three
 *  checks are the whole predicate; there is no wrapper. `lstatSync` is allowed
 *  to throw (ENOENT, EACCES): the caller that did not create the dir owns that
 *  failure, just as `serveOverUnixSocket` folds a throw into `bind-failed`. */
export function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  const st = lstatSync(dir);
  return st.isDirectory() && st.uid === getuid() && (st.mode & 0o077) === 0;
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

/** The three-way fact about what lives at `path`, the single source of truth
 *  both serve-flow branches read instead of each owning an inverted boolean.
 *  `lstat` (NOT `stat`) so a symlink is judged as itself and left intact
 *  rather than followed to its target:
 *  - `"socket"` — an actual socket inode (safe to `rmSync` + bind).
 *  - `"absent"` — nothing is there (ENOENT); a `rmSync` is a no-op and bind
 *    proceeds.
 *  - `"other"` — a regular file, dir, symlink, OR an inode we cannot classify
 *    (a non-ENOENT lstat error such as EACCES on the parent). This is the safe
 *    refuse-don't-unlink verdict: deleting it could destroy user data, and an
 *    unclassifiable inode must not be silently removed. */
function classifyInode(path: string): "socket" | "absent" | "other" {
  try {
    return lstatSync(path).isSocket() ? "socket" : "other";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    return "other";
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
  /** Stop accepting connections, DISCONNECT every established peer, and
   *  remove the socket file — the ordered teardown of surface-lifetime-audit
   *  step 3. The destroys are synchronous; each severed connection's serve
   *  then settles through its own chain in the event-loop turns BEHIND this
   *  call
   *  (subscriptions finalize, their timers clear) — `close()` returns
   *  without waiting for that. Closing one listener never touches another
   *  listener's connections.
   *  Idempotent, a no-op on a non-`listening` outcome, and safe to call
   *  synchronously from a `process.on("exit")` handler (the OS sockets and
   *  the file are severed synchronously; the async finalization needs a
   *  live event loop and is moot when the process is exiting). */
  close(): void;
}

/** A `SocketServer` whose whole population is ONE already-accepted connection.
 *
 *  Effect's server-side socket protocol is written against `SocketServer` (it
 *  wants to accept), while this module accepts for itself — it has to, because
 *  the bind-time hardening above (dir privacy, live probe, stale-inode
 *  clearing) and the ordered teardown below are the reasons this function
 *  exists. Rather than reimplement either half, the accepted `net.Socket` is
 *  handed to the protocol as a one-connection server: `run` serves it and then
 *  parks, exactly as `SocketServer.run`'s `Effect<never, …>` contract demands.
 *
 *  `NodeSocket.fromDuplex` is the same adapter the stdio/unix LINKS use, so
 *  both directions of the wire are framed by identical code. */
function oneConnectionSocketServer(
  socket: Socket,
  socketPath: string,
): Layer.Layer<SocketServer.SocketServer> {
  return Layer.effect(SocketServer.SocketServer)(
    Effect.map(
      NodeSocket.fromDuplex(
        Effect.acquireRelease(Effect.succeed(socket), (conn) =>
          Effect.sync(() => {
            if (!conn.destroyed) conn.destroy();
          }),
        ),
      ),
      (accepted) =>
        SocketServer.SocketServer.of({
          address: { _tag: "UnixAddress", path: socketPath },
          // `run`'s declared shape is `Effect<never, SocketServerError, R>`:
          // never returning, failing only the way an ACCEPTING server can. This
          // one cannot fail that way at all (there is nothing left to accept),
          // so the cast erases an error channel that is uninhabited here — the
          // handler's own failures stay in the handler's fiber.
          run: (handler) =>
            Effect.flatMap(
              handler(accepted),
              () => Effect.never,
            ) as unknown as Effect.Effect<
              never,
              SocketServer.SocketServerError,
              never
            >,
        }),
    ),
  );
}

/** The whole serving stack for ONE accepted connection: the RPC server, the
 *  shared handlers, ndjson, and that connection as its socket server. */
function servingLayer(
  group: RpcGroup.RpcGroup<Rpc.Any>,
  handlers: SurfaceHandlers,
  socket: Socket,
  socketPath: string,
): Layer.Layer<never, unknown> {
  return surfaceRpcServerLayer(group, handlers).pipe(
    Layer.provide(RpcServer.layerProtocolSocketServer),
    Layer.provide(rpcSerializationLayer),
    Layer.provide(oneConnectionSocketServer(socket, socketPath)),
  );
}

/** Serve `handlers` over a unix socket at `socketPath`. No TRANSPORT failure
 *  rejects or throws — every one of them resolves to a no-op listener whose
 *  `outcome` says why, so a host process can treat the socket as purely
 *  additive. The flow: create the parent dir `0700` → verify it's private →
 *  probe the path for a live peer → clear a provably-stale socket inode
 *  (and only that) → listen. Every accepted connection is served by ONE
 *  `RpcServer` over the shared handlers.
 *
 *  The ONE thing that does throw is an `expose` built from a different surface
 *  than the one being served, and it is deliberately not an `outcome`: an
 *  outcome is a verdict about the host's *environment* (a path someone else
 *  took, a dir we don't own) which the caller is expected to survive, whereas a
 *  mismatched exposure is the author's own mistake and there is no listener
 *  worth having on the far side of it. Degrading it to a no-op would hide a
 *  security gate that never took effect. */
export async function serveOverUnixSocket(opts: {
  socketPath: string;
  /** The served surface's flat `RpcGroup` — `runtime.group`. */
  group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`. */
  handlers: SurfaceHandlers;
  /** THIS face's default-deny allowlist — `exposeFace(surface, { … })` (or
   *  `exposeFaces` for a sibling bundle). Omit and the socket serves the whole
   *  surface. The rule, and which faces take one, live in
   *  `@kolu/surface/expose`. */
  expose?: FaceExposure;
  /** Where this listener's own lifetime is narrated (bound / post-listen fault /
   *  closed). REQUIRED — see the seam's note at the top of this module. */
  log: Logger;
}): Promise<UnixSocketListener> {
  const { socketPath, group, log } = opts;
  // This face's gate, before anything binds — unconditionally, because
  // `restrictHandlers` owns what an absent policy means (`./expose`).
  const handlers = restrictHandlers(group, opts.handlers, opts.expose);
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
      // A non-`ECONNREFUSED`/`ENOENT` probe error normally means "I couldn't
      // tell what's here" (EACCES, EPERM). But a regular file at the path can
      // surface as `ENOTSOCK` on some platforms — that IS knowable, so lstat
      // settles it into the precise `not-a-socket` verdict instead of an
      // opaque `probe-failed`. A truly unclassifiable inode stays a failure.
      if (classifyInode(socketPath) === "other") {
        return refused({ kind: "not-a-socket" });
      }
      return refused({ kind: "probe-failed", code: probe.code });
    }
    // probe.kind === "stale": ECONNREFUSED (a crashed peer's leftover inode)
    // or ENOENT (nothing there — the fresh-start case). Clear the path so
    // listen() won't EADDRINUSE, but ONLY if the inode is actually a socket
    // (or already gone): an arbitrary user-supplied path pointed at a
    // regular file/dir/symlink must refuse, never silently unlink data.
    if (classifyInode(socketPath) === "other") {
      return refused({ kind: "not-a-socket" });
    }
    rmSync(socketPath, { force: true });

    // The established-peer index, CLOSURE-scoped per listener — never module
    // scope, where two listeners in one process (a real config: the tests
    // round-trip several; kaval wraps its own) would alias one Set and closing
    // listener A would destroy listener B's live connections. Each entry is
    // the peer's socket plus the scope its serve lives in.
    const peers = new Set<{ socket: Socket; scope: Scope.Closeable }>();
    const server = createServer((socket) => {
      const scope = Scope.makeUnsafe();
      const peer = { socket, scope };
      peers.add(peer);
      const release = () => {
        if (!peers.delete(peer)) return;
        Effect.runFork(Scope.close(scope, Exit.void));
      };
      socket.once("close", release);
      // A client vanishing mid-frame must not take down the listener — and an
      // 'error' with no listener is a hard process crash. DEBUG, as master had
      // it: a peer dying mid-frame is routine (a kaval-tui closing its window),
      // so it must not compete with the listener-level lines above for an
      // operator's attention — but it must not be invisible either.
      socket.on("error", (err) => {
        log.debug({ socketPath, err }, "unix-socket peer error");
        release();
      });
      // Serving is per connection (as it was when each peer got its own
      // `serveOverStdio`), so a peer's teardown closes ONLY its own scope.
      // That is not merely tidiness: a single shared `NodeSocketServer` puts
      // the accepting server's own `close()` inside the same scope, and Node's
      // `server.close()` does not complete until every established connection
      // has ended — so tearing the listener down while a peer is connected
      // DEADLOCKS the scope close, and nothing ever destroys the peer.
      void Effect.runPromise(
        Scope.provide(
          Layer.build(servingLayer(group, handlers, socket, socketPath)),
          scope,
        ),
      ).catch(() => {
        // A per-connection build failure kills that peer, never the listener.
        release();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    log.info({ socketPath }, "unix-socket listener bound");
    // Post-listen server faults must not crash the host — but they must not be
    // SWALLOWED either. This handler existed to keep an 'error' with no listener
    // from being a hard process crash; the Effect port kept the arm and dropped
    // the line (`server.on("error", () => {})`), which is how #2101's comatose
    // listening socket produced no trace at all. The whole `err` travels (pino
    // serializes it with its stack), plus the path, so one grep over a host's
    // daemon logs answers "which socket faulted, and with what".
    server.on("error", (err) =>
      log.error(
        { socketPath, err },
        "unix-socket listener error (post-listen)",
      ),
    );

    let closed = false;
    return {
      socketPath,
      outcome: { kind: "listening" },
      close() {
        if (closed) return;
        closed = true;
        // Narrated BEFORE the teardown, so the line survives even if a destroy
        // throws — and so the log reads in causal order when a peer's severed
        // connection logs its own death in the turns behind this call.
        log.info({ socketPath }, "unix-socket listener closed");
        // The ordered teardown (surface-lifetime-audit step 3): stop accepting
        // → DISCONNECT established peers → release the inode, all
        // SYNCHRONOUSLY, so `close()` stays safe to call from a
        // `process.on("exit")` handler where no further event-loop turn will
        // ever come. The destroy is unconditional — a wedged half-open peer
        // gets no drain negotiation, and its unflushed outbound frames are
        // dropped (fail-fast: a host that closed is closed). Each destroy runs
        // that peer's own teardown behind this call: its socket's 'close'
        // releases the serve scope, which interrupts the peer's in-flight
        // handlers so their subscriptions finalize and their timers clear.
        server.close();
        for (const peer of [...peers]) peer.socket.destroy();
        rmSync(socketPath, { force: true });
      },
    };
  } catch (err) {
    // Most often EADDRINUSE: another instance won the race for this path.
    return refused({ kind: "bind-failed", err });
  }
}
