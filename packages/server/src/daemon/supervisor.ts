/**
 * Daemon supervisor — owns the kolu-server side of the local PTY-host
 * daemon's lifecycle (`kolu --stdio`, R4c).
 *
 * Responsibilities:
 *  1. Try to connect to an existing `$KOLU_STATE_DIR/agent.sock`. If one
 *     responds, reuse it (the common path on every kolu-server restart
 *     after the first — the daemon and its PTYs survived).
 *  2. If no daemon is alive, spawn the kolu binary with `--stdio` as a
 *     detached child (`detached: true` + `child.unref()`), so the daemon
 *     outlives this kolu-server process.
 *  3. Poll for the socket (50 ms backoff, 5 s overall) until the daemon
 *     finishes binding it; then connect.
 *  4. Issue `system.version` to verify contract compatibility (the
 *     wire-shape semver — most kolu upgrades stay compatible across a
 *     running daemon). On incompatible skew we fail closed: throw rather
 *     than report success over a daemon whose RPCs may fail in arbitrary
 *     ways. The operator kills the stale daemon so a matching one starts.
 *  5. Expose the typed `AgentClient` for `LocalTerminalBackend` and any
 *     consumer that wants to call into the daemon.
 *
 * Reconnect: `ClientRetryPlugin` (installed by `createStdioCellsClient`)
 * re-subscribes streams on a *transport* error, but a local stdio socket
 * can't self-heal once the daemon process dies — so `ensureDaemon` is
 * reconnect-aware: it drops a `closed` cached handle and re-runs
 * connect-or-spawn, and `LocalTerminalBackend`'s metadata loop re-`await`s
 * it on stream end. The single-instance gate + exec-arg filter live in
 * `./daemonUtils.ts` (a different volatility axis), shared with the daemon
 * entrypoint.
 */

import { spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import {
  AGENT_CONTRACT_VERSION,
  type AgentSystemVersion,
  type agentSurface,
  isAgentContractCompatible,
} from "kolu-common/agentSurface";
import pkg from "../../package.json" with { type: "json" };
import { daemonPaths } from "../koluState.ts";
import { log } from "../log.ts";
import { daemonExecArgv } from "./daemonUtils.ts";

/** Version-skew POLICY — a different change axis (2c) from the spawn/connect
 *  path (2b) it's called within. Throws fail-closed on an incompatible
 *  contract major.minor (a stale daemon that survived a breaking upgrade
 *  cannot be talked to safely; the operator kills it so a matching one
 *  starts). Returns `outdated` when the daemon is wire-compatible but a
 *  different build — surviving a deploy with stale code, which R4d surfaces
 *  as the "update pending" nudge. Caller owns the socket, so it disposes on
 *  throw; this function only decides. */
function checkDaemonVersion(
  versionInfo: AgentSystemVersion,
  socketPath: string,
): { outdated: boolean } {
  if (
    !isAgentContractCompatible(
      versionInfo.contractVersion,
      AGENT_CONTRACT_VERSION,
    )
  ) {
    throw new Error(
      `Local PTY daemon contract ${versionInfo.contractVersion} is incompatible ` +
        `with this kolu-server (expects ${AGENT_CONTRACT_VERSION}). A stale daemon ` +
        `(pid ${versionInfo.pid}) is holding ${socketPath}; kill it so a matching ` +
        `daemon can start.`,
    );
  }
  return { outdated: versionInfo.pkgVersion !== pkg.version };
}

/** The typed client for the daemon's `agentSurface` contract, with the
 *  `ClientRetryPlugin` context threaded through (the same shape
 *  `createStdioCellsClient` returns). Procedures and streams are nested
 *  under `surface.` — `defineSurface` puts every contract entry inside
 *  the surface namespace (e.g. `client.surface.system.version`). */
export type AgentClient = ContractRouterClient<
  typeof agentSurface.contract,
  ClientRetryPluginContext
>;

export interface DaemonHandle {
  client: AgentClient;
  socketPath: string;
  /** Daemon-reported PID. Used to SIGTERM the daemon on restart. */
  daemonPid: number;
  /** Daemon-reported contract version (e.g. "1.0"). */
  contractVersion: string;
  /** Wire-compatible but a different build than this kolu-server — the
   *  daemon survived a deploy and is serving stale code. R4d surfaces this
   *  as the "update pending" nudge; R4c only records it. */
  outdated: boolean;
  /** Connection state. `live` until the underlying socket closes. */
  state(): "live" | "closed";
  /** Close the supervisor's socket (does NOT kill the daemon). */
  dispose(): void;
}

/** Attempt a single connect with a short timeout. Returns the socket on
 *  success, undefined on `ENOENT`/`ECONNREFUSED` (no daemon yet). */
async function tryConnect(
  socketPath: string,
  timeoutMs: number,
): Promise<Socket | undefined> {
  return await new Promise((resolve) => {
    const sock = createConnection(socketPath);
    const cleanup = (s: Socket | undefined): void => {
      sock.removeListener("connect", onConnect);
      sock.removeListener("error", onError);
      clearTimeout(timer);
      resolve(s);
    };
    const onConnect = (): void => cleanup(sock);
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code !== "ENOENT" && err.code !== "ECONNREFUSED") {
        log.warn({ err: err.message, socketPath }, "supervisor: connect error");
      }
      sock.destroy();
      cleanup(undefined);
    };
    sock.once("connect", onConnect);
    sock.once("error", onError);
    const timer = setTimeout(() => {
      sock.destroy();
      cleanup(undefined);
    }, timeoutMs);
  });
}

/** Spawn the kolu binary in `--stdio` mode as a detached child. The
 *  child's stdout/stderr are redirected into `agent.log`; stdin is
 *  ignored (the daemon serves over its unix socket, not stdio).
 *
 *  `process.execPath` is the node/tsx runtime; `argv[1]` is the entry
 *  script (kolu's `index.ts` under tsx, or the bundled output in
 *  nix-built kolu) — load-bearing, or the runtime has nothing to run.
 *  `env: process.env` carries `KOLU_STATE_DIR` / `KOLU_GH_BIN` /
 *  `NIX_ENV_WHITELIST` + git identity through to the daemon: the
 *  nix wrapper's `makeWrapper --set` does NOT reach spawned children, so
 *  passing the parent env explicitly is required (the parent server was
 *  itself wrapped, so `process.env` already holds them). */
function spawnDaemon(logFile: string): void {
  const fd = openSync(logFile, "a", 0o600);
  const args = [
    ...daemonExecArgv(process.execArgv),
    ...(process.argv[1] ? [process.argv[1]] : []),
    "--stdio",
  ];
  log.info(
    { execPath: process.execPath, args, logFile },
    "supervisor: spawning daemon",
  );
  const child = spawnChild(process.execPath, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  // Don't error if the spawn itself fails — the polling loop below will
  // time out and the kolu-server boot fails cleanly.
  child.on("error", (err) => {
    log.error({ err: err.message }, "supervisor: daemon spawn error");
  });
}

let cached: DaemonHandle | undefined;
/** In-flight connect, so concurrent `ensureDaemon` callers (boot +
 *  `LocalTerminalBackend`'s metadata loop after a drop) share one spawn
 *  rather than racing two daemons into the pid-file gate. */
let connecting: Promise<DaemonHandle> | undefined;

/** Snapshot accessor for downstream consumers (`LocalTerminalBackend`'s
 *  write/resize/attach proxies). Throws if `ensureDaemon` has not resolved
 *  yet — callers must `await ensureDaemon()` once at boot before reaching
 *  for the handle. Returns the current (possibly reconnected) handle. */
export function getDaemonHandle(): DaemonHandle {
  if (!cached) {
    throw new Error("getDaemonHandle: ensureDaemon() not called");
  }
  return cached;
}

/** Connect to (or spawn-and-connect-to) the local PTY-host daemon.
 *  Reconnect-aware: a live cached handle is reused, but a `closed` one
 *  (the daemon died / the socket dropped) is dropped and re-established —
 *  a stdio socket can't self-heal, so the only recovery is a fresh
 *  connect-or-spawn (`tryConnect` reuses a surviving daemon; if it's truly
 *  gone, a fresh empty one is spawned). `LocalTerminalBackend`'s metadata
 *  loop re-`await`s this on stream end, so a daemon hiccup re-warms rather
 *  than silently freezing metadata for every terminal. */
export async function ensureDaemon(): Promise<DaemonHandle> {
  if (cached && cached.state() === "live") return cached;
  if (connecting !== undefined) return connecting;
  if (cached) {
    cached.dispose();
    cached = undefined;
  }
  connecting = ensureDaemonImpl().then(
    (handle) => {
      cached = handle;
      connecting = undefined;
      return handle;
    },
    (err) => {
      connecting = undefined;
      throw err;
    },
  );
  return connecting;
}

/** Poll until the daemon's socket file disappears (the daemon unlinks it
 *  in its SIGTERM cleanup, alongside the pid file). A fresh daemon can
 *  only acquire the pid file once the old one releases it, so this is the
 *  barrier before respawning. Resolves early once gone; resolves anyway
 *  at the deadline. */
async function waitForSocketGone(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Restart the local PTY daemon on explicit user request — the action
 *  behind the "update pending" nudge. SIGTERMs the running daemon (its
 *  cleanup disposes every PTY and unlinks the socket + pid file), waits
 *  for the socket to clear, then spawns a fresh one via `ensureDaemon`.
 *  This is the single moment R-4 accepts PTY loss: the user chose it. If
 *  no daemon was running, this just starts one. */
export async function restartDaemon(): Promise<void> {
  const current = cached;
  if (current) {
    try {
      process.kill(current.daemonPid, "SIGTERM");
    } catch (err) {
      // ESRCH (already gone) is fine — we respawn regardless.
      log.warn(
        { err: (err as Error).message, pid: current.daemonPid },
        "supervisor: SIGTERM to daemon failed (already gone?)",
      );
    }
    current.dispose();
    cached = undefined;
    await waitForSocketGone(current.socketPath, 5_000);
  }
  await ensureDaemon();
}

async function ensureDaemonImpl(): Promise<DaemonHandle> {
  const { socketPath, logFile } = daemonPaths();

  // First, try to reuse an already-running daemon (the common path on
  // every kolu-server restart after the first).
  let socket = await tryConnect(socketPath, 200);

  if (!socket) {
    spawnDaemon(logFile);
    // Poll until the daemon binds the socket, up to 5 s.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      socket = await tryConnect(socketPath, 200);
      if (socket) break;
    }
  }

  if (!socket) {
    throw new Error(
      `Daemon failed to start: socket ${socketPath} did not appear within 5s. ` +
        `See ${logFile} for the daemon's own log output.`,
    );
  }

  const client = createStdioCellsClient<typeof agentSurface.contract>({
    read: socket,
    write: socket,
  });

  // Version handshake. Procedures are nested under `surface.` because
  // `defineSurface` puts every contract entry inside the surface namespace
  // (matches remote-process-monitor's `client.surface.*`). The skew POLICY
  // lives in `checkDaemonVersion` (axis 2c); we only own the socket here.
  const versionInfo = await client.surface.system.version({});
  let outdated: boolean;
  try {
    ({ outdated } = checkDaemonVersion(versionInfo, socketPath));
  } catch (err) {
    socket.destroy(); // fail closed
    throw err;
  }
  log.info(
    {
      daemonPid: versionInfo.pid,
      contractVersion: versionInfo.contractVersion,
      pkgVersion: versionInfo.pkgVersion,
      serverPkgVersion: pkg.version,
      outdated,
      socketPath,
    },
    outdated
      ? "supervisor: daemon connected but running stale code — restart to apply update"
      : "supervisor: daemon connected",
  );

  let state: "live" | "closed" = "live";
  socket.on("close", () => {
    state = "closed";
    log.warn({ socketPath }, "supervisor: daemon socket closed");
  });
  socket.on("error", (err) => {
    log.warn({ err: err.message }, "supervisor: socket error");
  });

  return {
    client,
    socketPath,
    daemonPid: versionInfo.pid,
    contractVersion: versionInfo.contractVersion,
    outdated,
    state: () => state,
    dispose: () => {
      socket?.destroy();
    },
  };
}
