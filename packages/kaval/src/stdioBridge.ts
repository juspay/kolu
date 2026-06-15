/**
 * `kaval --stdio` — front the durable daemon over a stdio byte bridge.
 *
 * R-2's remote transport: `kaval-tui --host <ssh>` (and, later, kolu-server)
 * reaches a remote kaval through `@kolu/surface-nix-host`'s `getHostSession`,
 * which runs `ssh <host> kaval --stdio` and speaks `ptyHostSurface` over that
 * child's stdin/stdout. But a remote PTY must **survive** the ssh link that
 * created it (detach on the train, reattach at the café) — so `--stdio` is NOT
 * a fresh in-process pty-host per link (that would die with the link, and a
 * second `attach` would find an empty host). Instead it **fronts the durable
 * daemon**: ensure ONE long-lived `kaval` daemon is serving its unix socket on
 * the host (adopt the running one, else spawn it — the daemon's pid-gate makes
 * that single-instance), then transparently splice this process's stdio to that
 * socket.
 *
 * The splice is a *raw byte relay*, not a re-serve: kaval's unix socket and an
 * ssh stdio link carry the **same** `@kolu/surface` peer framing
 * (base64+newline — `serveOverUnixSocket` and the client's `stdioLink` both wrap
 * a Duplex in `links/stdio`'s codec), so the client's link talks to the
 * daemon's socket-served router straight through this pipe with no decode. The
 * bridge therefore needs no surface/oRPC import at all — only `node:net`,
 * `node:child_process`, and the shared socket-path resolver — which is also what
 * keeps it inside the daemon-closure allow-list (`buildId.closure.test.ts`).
 *
 * One process per ssh link, sharing one durable daemon: N concurrent links open
 * N socket connections to the same host, all serving the same PTYs. The bridge
 * dies with its link; the daemon it fronts does not.
 *
 * Stdout IS the wire: every diagnostic goes to stderr, or a stray byte corrupts
 * the next frame (the lesson `serveOverStdio` encodes for the serve side).
 */

import { spawn } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { getPtyHostSocketPath, KAVAL_NS_PREFIX } from "./socketPath.ts";

/** How long to wait for a freshly-spawned daemon's socket to start listening
 *  before giving up. A cold spawn (load the closure, take the gate, bind) is
 *  sub-second; this is the unhealthy-start ceiling, not a normal wait. */
const DEFAULT_DAEMON_WAIT_MS = 10_000;
/** Poll cadence while waiting for the daemon's socket to appear. */
const DEFAULT_POLL_MS = 100;

export interface StdioBridgeDeps {
  /** Override the daemon socket to front (`--socket`); the spawned daemon, if
   *  any, is launched to serve the same path. Default: kaval's own namespace. */
  socketOverride?: string;
  /** The link's inbound byte stream. Default `process.stdin`. */
  stdin?: Readable;
  /** The link's outbound byte stream. Default `process.stdout` — the wire. */
  stdout?: Writable;
  /** Diagnostic sink (stderr by default; stdout is forbidden — it's the wire). */
  log?: (msg: string) => void;
  /** Connect to a unix socket. Injected in tests; default `net.createConnection`. */
  connect?: (socketPath: string) => Socket;
  /** Ensure a durable daemon is (being) started. Injected in tests; default
   *  re-execs this same runtime+entry minus `--stdio` as a detached daemon. */
  spawnDaemon?: () => void;
  /** Total time to wait for a just-spawned daemon's socket. Default 10s. */
  daemonWaitMs?: number;
  /** Poll cadence while waiting for the socket. Default 100ms. */
  pollMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Re-exec this very program as a detached, durable daemon: same runtime and
 *  entry, minus the `--stdio` flag, so `node --import <loader> bin.ts` (the
 *  signal-deliverable single-process form the daemon needs) runs `daemonMain`.
 *  `detached` + `stdio: "ignore"` + `unref` decouple it from the ssh session,
 *  so it survives the SIGHUP that closing the link delivers; the inherited env
 *  carries the wrapper's `KAVAL_BUILD_ID`/PATH. The daemon's own pid-gate makes
 *  a concurrent second launch a clean no-op (it yields, exits 0). */
function spawnDetachedDaemon(): void {
  const args = [
    ...process.execArgv,
    ...process.argv.slice(1).filter((a) => a !== "--stdio"),
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}

/** Resolve a connected socket to a live daemon. Connect to the current daemon
 *  if one is already serving; otherwise ensure one is started and poll until it
 *  binds (or the wait deadline). Rejects only if no daemon is listening within
 *  `daemonWaitMs` of the spawn — an honest "the daemon won't come up" rather
 *  than a hang. */
async function connectToDaemon(deps: StdioBridgeDeps): Promise<Socket> {
  const socketPath = getPtyHostSocketPath(deps.socketOverride, KAVAL_NS_PREFIX);
  const connect = deps.connect ?? createConnection;
  const log =
    deps.log ?? ((msg) => process.stderr.write(`kaval --stdio: ${msg}\n`));

  // A daemon already owns the socket — front it, no spawn. A non-retryable
  // connect error (a path we can't probe / isn't a socket) propagates instead
  // of being read as "no daemon" — see `tryConnect`.
  const existing = await tryConnect(connect, socketPath);
  if (existing) return existing;

  // None yet — start one (idempotent under the pid-gate) and wait for its
  // socket. A racing link spawns its own; only the gate winner binds, and both
  // links then connect to that one socket.
  log(`no daemon at ${socketPath} — starting one`);
  (deps.spawnDaemon ?? spawnDetachedDaemon)();

  const deadline = Date.now() + (deps.daemonWaitMs ?? DEFAULT_DAEMON_WAIT_MS);
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
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
    `daemon did not start listening at ${socketPath} within ${deps.daemonWaitMs ?? DEFAULT_DAEMON_WAIT_MS}ms`,
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
 *  either end closes — then drop the socket and resolve so the bin exits. The
 *  daemon stays up; only this front goes away with its link. `process.stdout`
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
    // connection, or the ssh peer closed its input. The outbound `stdout` is
    // watched too — if the ssh client's read side closes while the daemon is
    // still writing, the resulting `EPIPE`/`close` resolves the relay cleanly
    // instead of crashing the bridge with an unhandled writable-stream error.
    socket.once("close", finish);
    socket.once("error", finish);
    stdin.once("end", finish);
    stdin.once("error", finish);
    stdout.once("error", finish);
    stdout.once("close", finish);
  });
}

/** Run the `--stdio` bridge: connect to (or start) the durable daemon, then
 *  relay this process's stdio onto its socket for the lifetime of the link. */
export async function runStdioBridge(
  deps: StdioBridgeDeps = {},
): Promise<void> {
  const stdin = deps.stdin ?? process.stdin;
  const stdout = deps.stdout ?? process.stdout;
  const socket = await connectToDaemon(deps);
  await relay(socket, stdin, stdout);
}
