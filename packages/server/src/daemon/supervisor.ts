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
 * Reconnect on disconnect (e.g. the daemon crashed and was respawned by
 * an OS-level supervisor, or this kolu-server lost its socket connection)
 * is provided by `@orpc/client/plugins` `ClientRetryPlugin`, which
 * `createStdioCellsClient` installs by default. The retry plugin handles
 * streaming re-subscribe transparently — see `.claude/rules/streaming.md`.
 *
 * The single-instance pid-file gate (`tryAcquirePidFile`) lives here so
 * both this supervisor and the daemon entrypoint (`../agent/main.ts`,
 * which imports it) share one atomic implementation.
 */

import { spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import {
  AGENT_CONTRACT_VERSION,
  type agentSurface,
  isAgentContractCompatible,
} from "kolu-common/agentSurface";
import pkg from "../../package.json" with { type: "json" };
import { daemonPaths } from "../koluState.ts";
import { log } from "../log.ts";
import { daemonExecArgv } from "./daemonUtils.ts";

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

/** Snapshot accessor for downstream consumers (status indicator,
 *  `LocalTerminalBackend`). Throws if `ensureDaemon` has not resolved yet
 *  — callers must `await ensureDaemon()` before reaching for the handle. */
export function getDaemonHandle(): DaemonHandle {
  if (!cached) {
    throw new Error("getDaemonHandle: ensureDaemon() not called");
  }
  return cached;
}

/** Connect to (or spawn-and-connect-to) the local PTY-host daemon.
 *  Idempotent — caches the handle for the lifetime of this kolu-server
 *  process. Returns once the daemon has responded to `system.version`. */
export async function ensureDaemon(): Promise<DaemonHandle> {
  if (cached) return cached;
  const handle = await ensureDaemonImpl();
  cached = handle;
  return handle;
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
  // `defineSurface` puts every contract entry inside the surface
  // namespace (matches remote-process-monitor's `client.surface.*`).
  const versionInfo = await client.surface.system.version({});
  if (
    !isAgentContractCompatible(
      versionInfo.contractVersion,
      AGENT_CONTRACT_VERSION,
    )
  ) {
    // Fail closed: an incompatible daemon (a stale one that survived an
    // upgrade with a breaking contract change) cannot be talked to
    // safely. The daemon is single-instance per state dir, so the operator
    // must kill the stale one (`kill <pid>` / remove the socket) to let
    // this kolu-server spawn a matching daemon on next boot.
    socket.destroy();
    throw new Error(
      `Local PTY daemon contract ${versionInfo.contractVersion} is incompatible ` +
        `with this kolu-server (expects ${AGENT_CONTRACT_VERSION}). A stale daemon ` +
        `(pid ${versionInfo.pid}) is holding ${socketPath}; kill it so a matching ` +
        `daemon can start.`,
    );
  }
  // Wire-compatible but a different build: the daemon survived a deploy
  // and is serving stale code. Keep using it (the daemon is a thin,
  // rarely-changing primitive — all volatile logic lives in kolu-server
  // and updated freely this deploy), but flag it for the status indicator.
  const outdated = versionInfo.pkgVersion !== pkg.version;
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
  // R4d will surface this (the `localPtyDaemon` status cell + ChromeBar dot
  // + the "update pending" nudge that drives the user-triggered restart);
  // R4c keeps it to a log line + the fail-closed handshake above.

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
    state: () => state,
    dispose: () => {
      socket?.destroy();
    },
  };
}
