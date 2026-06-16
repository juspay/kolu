/**
 * `connectHostKaval` — kolu-watcher's internal sub-client to the host-local
 * kaval.
 *
 * The watcher serves ONE surface over its ssh stdio (it is a `serveOverStdio`
 * server, NOT a raw `frontDaemonOverStdio` relay), and fulfils the absorbed
 * pty-host verbs/taps by being an ordinary CLIENT of the host's durable kaval
 * over its unix socket. This is the "serve, don't relay" half of P3's
 * serve+front composition: kaval stays a separate durable daemon on the host;
 * the watcher forwards to it.
 *
 * Adopt-or-spawn, mirroring `kaval --stdio`'s own front (`frontDaemonOverStdio`)
 * but yielding a TYPED client rather than a byte relay: connect to the kaval
 * already serving the socket; if none is, spawn the `kaval` binary as a
 * detached daemon and poll until its socket binds (or the deadline — an honest
 * "kaval won't come up" rather than a hang). The watcher cannot
 * `reExecAsDetachedDaemon` (that would re-exec the watcher, not kaval), so it
 * spawns the kaval binary handed to it (nix bakes the path).
 */

import { spawn } from "node:child_process";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import {
  getPtyHostSocketPath,
  KAVAL_NS_PREFIX,
  type ptyHostSurface,
  PTY_HOST_CONTRACT_VERSION,
} from "kaval";

/** The contract-typed kaval client the watcher forwards pty verbs/taps to. */
export type HostKavalClient = UnixSocketConnection<
  typeof ptyHostSurface.contract
>["client"];

export interface HostKaval {
  client: HostKavalClient;
  /** Tear down the socket connection. Does NOT stop the durable kaval daemon
   *  — it outlives this link, the whole point of P3's survive-detach model. */
  dispose: () => void;
}

export interface ConnectHostKavalOptions {
  /** Absolute path to the `kaval` binary to spawn when none is serving the
   *  socket yet (nix bakes it as `KOLU_WATCHER_KAVAL_BIN`). When absent, the
   *  watcher only adopts an already-running kaval and rejects otherwise — the
   *  shape an in-process test uses (it pre-binds the socket itself). */
  kavalBin?: string;
  /** Override the kaval socket path (else the per-user kaval namespace). The
   *  spawned daemon is given the matching `--socket` so both resolve one path. */
  socketOverride?: string;
  /** Diagnostics to stderr — stdout is the watcher's ssh wire, never log there. */
  log?: (msg: string) => void;
  /** Total budget for a cold spawn to come up and bind. */
  connectTimeoutMs?: number;
}

const POLL_INTERVAL_MS = 100;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Connect to the kaval at the resolved socket. Resolves with a typed client,
 *  or rejects if kaval can't be reached (and can't be spawned). */
export async function connectHostKaval(
  opts: ConnectHostKavalOptions = {},
): Promise<HostKaval> {
  const log = opts.log ?? (() => {});
  const socketPath = getPtyHostSocketPath(opts.socketOverride, KAVAL_NS_PREFIX);

  // 1. Adopt — connect to a kaval already serving the socket.
  const adopted = await tryConnect(socketPath);
  if (adopted) return await handshake(adopted, log);

  // 2. Spawn — no kaval yet; start the durable daemon and poll until it binds.
  if (!opts.kavalBin) {
    throw new Error(
      `no kaval serving ${socketPath} and no kavalBin to spawn one`,
    );
  }
  log(`no kaval at ${socketPath}; spawning ${opts.kavalBin}`);
  spawnKavalDaemon(opts.kavalBin, opts.socketOverride);

  const deadline =
    performance.now() + (opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
  while (performance.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const conn = await tryConnect(socketPath);
    if (conn) return await handshake(conn, log);
  }
  throw new Error(`kaval did not bind ${socketPath} within the deadline`);
}

/** One connect attempt — resolves the connection, or null on a refused/absent
 *  socket (the expected "not up yet" outcome the spawn+poll loop retries). */
async function tryConnect(socketPath: string): Promise<HostKaval | null> {
  try {
    const { client, dispose } = await unixSocketLink<
      typeof ptyHostSurface.contract
    >({ socketPath });
    return { client, dispose };
  } catch {
    return null;
  }
}

/** Confirm the adopted/spawned kaval is live and wire-compatible before the
 *  watcher starts forwarding to it — an incompatible skew is an honest failure,
 *  not a stream of opaque schema errors from deep in the forward path. */
async function handshake(
  conn: HostKaval,
  log: (msg: string) => void,
): Promise<HostKaval> {
  const version = await conn.client.surface.system.version({});
  if (
    !isContractVersionCompatible(
      version.contractVersion,
      PTY_HOST_CONTRACT_VERSION,
    )
  ) {
    conn.dispose();
    throw new Error(
      `host kaval contract ${version.contractVersion} is incompatible with ` +
        `the watcher's expected ${PTY_HOST_CONTRACT_VERSION}`,
    );
  }
  log(`connected to host kaval (contract ${version.contractVersion})`);
  return conn;
}

/** Spawn the kaval binary as a detached, gate-held daemon. Idempotent under
 *  kaval's own pid-gate — a racing second spawn is a clean no-op, so the
 *  watcher needn't coordinate. Detached + unref'd so it outlives this process
 *  (the durable-survivor contract); stdio ignored (it logs to its own stderr). */
function spawnKavalDaemon(kavalBin: string, socketOverride?: string): void {
  const args = socketOverride ? ["--socket", socketOverride] : [];
  const child = spawn(kavalBin, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
