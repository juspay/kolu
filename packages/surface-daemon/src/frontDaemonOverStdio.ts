/**
 * `frontDaemonOverStdio` — front a durable surface daemon over a stdio byte
 * bridge. The **durable counterpart** to `@kolu/surface`'s `serveOverStdio`.
 *
 * `serveOverStdio(router)` is the *ephemeral* remote agent: the `--stdio`
 * process **is** the server, a fresh one per link, and when the link drops the
 * server (and any state it held) is gone — exactly right for a re-run-fresh
 * agent (`mini-ci`, `remote-process-monitor`, drishti). `frontDaemonOverStdio`
 * is the other primitive in the family: a **contract-agnostic proxy** in front
 * of a *separate, gate-held* daemon. The link reaches a long-lived daemon whose
 * state **outlives** it — the mosh / tmux / `dtach` / `abduco` lineage,
 * generalized from a PTY to any `@kolu/surface` daemon: detach on the train,
 * reattach at the café, the session is still there.
 *
 * It does two things and nothing else:
 *
 *   1. **Adopt-or-spawn.** Connect to the daemon already serving `socketPath`;
 *      if none is, call `spawnDaemon` (idempotent under the daemon's own
 *      pid-gate — a racing second link is a clean no-op) and poll until its
 *      socket binds (or the wait deadline — an honest "the daemon won't come up"
 *      rather than a hang).
 *
 *   2. **Raw byte relay.** Splice this process's stdin⇄stdout onto the daemon
 *      socket, both directions, until either end closes. **No decode:** a unix
 *      socket served by `serveOverUnixSocket` and a client's `stdioLink` carry
 *      the *same* `@kolu/surface` peer framing (base64+newline), so the client
 *      talks to the socket-served router straight through this pipe. The proxy
 *      is therefore contract-blind — it needs no surface/oRPC import, only
 *      `node:net`/`node:child_process` — which is also what lets a consumer keep
 *      its daemon-closure allow-list intact (e.g. kaval's `buildId.closure.test`).
 *
 * One process per link, sharing one durable daemon: N concurrent links open N
 * socket connections to the same daemon, all serving the same state. The proxy
 * dies with its link; the daemon it fronts does not.
 *
 * Stdout IS the wire: every diagnostic goes to stderr (`log`), or a stray byte
 * corrupts the next frame — the same lesson `serveOverStdio` encodes for the
 * serve side.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";

/** How long to wait for a freshly-spawned daemon's socket to start listening
 *  before giving up. A cold spawn (load the closure, take the gate, bind) is
 *  sub-second; this is the unhealthy-start ceiling, not a normal wait. */
const DEFAULT_DAEMON_WAIT_MS = 10_000;
/** Poll cadence while waiting for the daemon's socket to appear. */
const DEFAULT_POLL_MS = 100;

export interface FrontDaemonOverStdioOptions {
  /** The unix socket of the durable daemon to front. The caller resolves it —
   *  its own namespace / rendezvous policy lives with the caller, not here. */
  socketPath: string;
  /** Ensure a durable daemon is (being) started, idempotently — invoked only
   *  when nothing is listening at `socketPath`. Required, no default: the front
   *  takes an opaque spawn so the caller owns how its daemon starts. The daemon's
   *  own pid-gate must make a racing second launch a clean no-op.
   *  `reExecAsDetachedDaemon` is the same-binary strategy kaval passes here; a
   *  consumer fronted by an external supervisor (systemd, …) supplies its own. */
  spawnDaemon: () => void;
  /** The link's inbound byte stream. Default `process.stdin`. */
  stdin?: Readable;
  /** The link's outbound byte stream. Default `process.stdout` — the wire. */
  stdout?: Writable;
  /** Diagnostic sink (stderr by default; stdout is forbidden — it's the wire). */
  log?: (msg: string) => void;
  /** Connect to a unix socket. Injected in tests; default `net.createConnection`. */
  connect?: (socketPath: string) => Socket;
  /** Total time to wait for a just-spawned daemon's socket. Default 10s. */
  daemonWaitMs?: number;
  /** Poll cadence while waiting for the socket. Default 100ms. */
  pollMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface ReExecAsDetachedDaemonOptions {
  /** argv tokens to drop when re-spawning — the flag(s) that put THIS process
   *  in front mode, so the re-exec lands in *daemon* mode instead (e.g. kaval's
   *  `["--stdio"]`). Matched as exact tokens. */
  stripArgs?: readonly string[];
  /** Environment for the detached daemon. Default `process.env` — carries the
   *  Nix wrapper's build-id / `PATH` the daemon needs. */
  env?: NodeJS.ProcessEnv;
  /** Injected in tests; default `node:child_process`'s `spawn`. */
  spawn?: typeof nodeSpawn;
}

/** Re-exec THIS program as a detached, durable daemon: same runtime and entry
 *  (`execPath` + `execArgv` + `argv[1..]`), minus `stripArgs`, so the
 *  **single-process** `node --import <loader> bin.ts` form runs — NOT a
 *  `tsx bin.ts` CLI fork, whose wrapper process swallows `SIGTERM` and leaks the
 *  daemon's socket + gate. `detached` + `stdio: "ignore"` + `unref` decouple it
 *  from the parent (ssh) session, so it survives the SIGHUP that closing the
 *  link delivers; the inherited env carries the wrapper's identity/PATH. The
 *  daemon's own pid-gate makes a concurrent second launch a clean no-op (it
 *  yields, exits 0). */
export function reExecAsDetachedDaemon(
  opts: ReExecAsDetachedDaemonOptions = {},
): void {
  const strip = new Set(opts.stripArgs ?? []);
  const spawn = opts.spawn ?? nodeSpawn;
  const args = [
    ...process.execArgv,
    ...process.argv.slice(1).filter((a) => !strip.has(a)),
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: opts.env ?? process.env,
  });
  child.unref();
}

/** Resolve a connected socket to a live daemon. Connect to the current daemon
 *  if one is already serving; otherwise ensure one is started and poll until it
 *  binds (or the wait deadline). Rejects only if no daemon is listening within
 *  `daemonWaitMs` of the spawn — an honest "the daemon won't come up" rather
 *  than a hang. */
async function connectToDaemon(
  opts: FrontDaemonOverStdioOptions,
): Promise<Socket> {
  const { socketPath } = opts;
  const connect = opts.connect ?? createConnection;
  const log =
    opts.log ?? ((msg) => process.stderr.write(`front-daemon: ${msg}\n`));

  // A daemon already owns the socket — front it, no spawn. A non-retryable
  // connect error (a path we can't probe / isn't a socket) propagates instead
  // of being read as "no daemon" — see `tryConnect`.
  const existing = await tryConnect(connect, socketPath);
  if (existing) return existing;

  // None yet — start one (idempotent under the pid-gate) and wait for its
  // socket. A racing link spawns its own; only the gate winner binds, and both
  // links then connect to that one socket.
  log(`no daemon at ${socketPath} — starting one`);
  opts.spawnDaemon();

  const deadline = Date.now() + (opts.daemonWaitMs ?? DEFAULT_DAEMON_WAIT_MS);
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  // Try immediately (a daemon that binds sub-second isn't taxed a full pollMs),
  // then sleep only BETWEEN retries. A daemon that comes up but rejects a path
  // we can't probe (e.g. perms tightened mid-wait) still propagates via
  // tryConnect rather than spinning to the deadline.
  while (Date.now() < deadline) {
    const sock = await tryConnect(connect, socketPath);
    if (sock) return sock;
    await sleep(pollMs);
  }
  // One last attempt past the deadline: the daemon may have bound during that
  // final sleep, after which the loop's `< deadline` check exits — don't fail
  // on a daemon that is, by now, actually listening.
  const last = await tryConnect(connect, socketPath);
  if (last) return last;
  throw new Error(
    `daemon did not start listening at ${socketPath} within ${opts.daemonWaitMs ?? DEFAULT_DAEMON_WAIT_MS}ms`,
  );
}

/** Connect errors that mean "no daemon is listening yet" — the expected
 *  poll-again signal, not a failure: the socket file is absent (`ENOENT`) or
 *  present but unbound (`ECONNREFUSED`). Anything else (`EACCES`/`EPERM` perms,
 *  `ENOTSOCK` a non-socket path, `ENOTDIR` a bad path component) means the path
 *  is *unprobeable*, not empty — a real config/safety error, not absence. */
const NO_DAEMON_CODES = new Set(["ENOENT", "ECONNREFUSED"]);

/** One connect attempt: resolve the socket on `connect`, `null` when no daemon
 *  is up yet (`ENOENT`/`ECONNREFUSED`), or reject for any other connect error.
 *  A refused/absent socket is the "not running yet" signal the caller polls on;
 *  an unprobeable path (`EACCES`, `ENOTSOCK`, …) must surface as itself rather
 *  than be misread as absence — which would spawn a daemon and then time out
 *  with a misleading message instead of naming the real fault. */
function tryConnect(
  connect: (socketPath: string) => Socket,
  socketPath: string,
): Promise<Socket | null> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const onError = (err: NodeJS.ErrnoException): void => {
      socket.removeListener("connect", onConnect);
      socket.destroy();
      if (err.code !== undefined && NO_DAEMON_CODES.has(err.code)) {
        resolve(null);
        return;
      }
      reject(err);
    };
    const onConnect = (): void => {
      socket.removeListener("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

/** Splice the link's stdio onto the daemon socket, both directions, until
 *  either end closes — then drop the socket and resolve so the front exits. The
 *  daemon stays up; only this proxy goes away with its link. `process.stdout`
 *  is never `.end()`-ed (the `{ end: false }`), so a finished relay closes the
 *  connection, not the process's own output. */
function relay(
  socket: Socket,
  stdin: Readable,
  stdout: Writable,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      stdin.unpipe(socket);
      socket.unpipe(stdout);
      socket.removeListener("close", finish);
      socket.removeListener("error", finish);
      stdin.removeListener("end", finish);
      stdin.removeListener("error", finish);
      stdout.removeListener("error", finish);
      stdout.removeListener("close", finish);
      socket.destroy();
      resolve();
    };
    // client → daemon (stdin EOF half-closes the socket's write side) and
    // daemon → client (but never close our own stdout).
    stdin.pipe(socket);
    socket.pipe(stdout, { end: false });
    // The link is over when EITHER side goes away: the daemon dropped the
    // connection, or the peer closed its input. The outbound `stdout` is
    // watched too — if the peer's read side closes while the daemon is still
    // writing, the resulting `EPIPE`/`close` resolves the relay cleanly instead
    // of crashing the proxy with an unhandled writable-stream error.
    socket.once("close", finish);
    socket.once("error", finish);
    stdin.once("end", finish);
    stdin.once("error", finish);
    stdout.once("error", finish);
    stdout.once("close", finish);
  });
}

/** Front the durable daemon over this process's stdio: connect to (or start)
 *  the daemon at `socketPath`, then relay stdin⇄stdout onto its socket for the
 *  lifetime of the link. Resolves when the link ends; the daemon it fronts
 *  keeps running. */
export async function frontDaemonOverStdio(
  opts: FrontDaemonOverStdioOptions,
): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const socket = await connectToDaemon(opts);
  await relay(socket, stdin, stdout);
}
