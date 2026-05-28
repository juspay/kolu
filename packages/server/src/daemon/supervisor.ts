/**
 * Daemon supervisor — owns the kolu-server side of the local PTY-host
 * daemon's lifecycle.
 *
 * Responsibilities:
 *  1. Try to connect to an existing `$KOLU_STATE_DIR/agent.sock`. If one
 *     responds, reuse it (this is the common path on every kolu-server
 *     restart after the first — the daemon survived).
 *  2. If no daemon is alive, spawn the kolu binary with `--stdio` as a
 *     detached child (`detached: true` + `child.unref()`), so the
 *     daemon outlives this kolu-server process.
 *  3. Poll for the socket (50 ms backoff, 5 s overall) until the daemon
 *     finishes binding it; then connect.
 *  4. Issue `system.version` to verify contract compatibility (the
 *     wire-shape semver — most kolu upgrades stay compatible across a
 *     running daemon). On skew, log a warning; the actual degraded-mode
 *     UI / kill-and-respawn handling is a follow-up.
 *  5. Expose the typed `AgentClient` for `LocalTerminalBackend` and any
 *     consumer that wants to call into the daemon.
 *
 * Reconnect on disconnect (e.g. the daemon crashed and was respawned
 * by an OS-level supervisor, or this kolu-server lost its socket
 * connection) is provided by `@orpc/client/plugins` `ClientRetryPlugin`
 * which `createStdioCellsClient` installs by default. The retry plugin
 * handles streaming re-subscribe transparently — see
 * `.claude/rules/streaming.md`.
 */

import { spawn as spawnChild } from "node:child_process";
import { openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import {
  AGENT_CONTRACT_VERSION,
  isAgentContractCompatible,
} from "kolu-common/agentSurface";
import type { agentSurface } from "kolu-common/agentSurface";
import { log } from "../log.ts";
import { daemonPaths } from "../koluState.ts";
import { surfaceCtx } from "../surfaceCtx.ts";

function setDaemonStatus(
  state: "starting" | "ready" | "down",
  fields: {
    pid?: number;
    contractVersion?: string;
    socketPath?: string;
  } = {},
): void {
  try {
    surfaceCtx.cells.localPtyDaemon.set({
      state,
      ...fields,
      lastSeenAt: state === "ready" ? Date.now() : undefined,
    });
  } catch (err) {
    // surfaceCtx may not be initialised yet on very early boot; the
    // cell defaults to {state:"starting"} so this is a no-op then.
    log.debug(
      { err: (err as Error).message },
      "supervisor: surfaceCtx not ready for daemon-status publish",
    );
  }
}

export type AgentClient = ContractRouterClient<
  typeof agentSurface.contract,
  ClientRetryPluginContext
>;

export interface DaemonHandle {
  client: AgentClient;
  socketPath: string;
  /** Daemon-reported PID. Useful for diagnostics. */
  daemonPid: number;
  /** Daemon-reported contract version (e.g. "1.0"). */
  contractVersion: string;
  /** Connection state. `live` until the underlying socket closes. */
  state(): "live" | "closed";
  /** Close the supervisor's socket (does NOT kill the daemon). */
  dispose(): void;
}

/** Attempt a single connect with a short timeout. Returns the socket
 *  on success, undefined on `ENOENT`/`ECONNREFUSED` (no daemon yet). */
async function tryConnect(
  socketPath: string,
  timeoutMs: number,
): Promise<Socket | undefined> {
  return await new Promise((resolve) => {
    const sock = createConnection(socketPath);
    const cleanup = (s: Socket | undefined) => {
      sock.removeListener("connect", onConnect);
      sock.removeListener("error", onError);
      clearTimeout(timer);
      resolve(s);
    };
    const onConnect = () => cleanup(sock);
    const onError = (err: NodeJS.ErrnoException) => {
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
 *  closed (the daemon serves over its unix socket, not stdio). */
function spawnDaemon(logFile: string): void {
  const fd = openSync(logFile, "a", 0o600);
  // process.execPath is the node binary; argv[1] is this script (kolu's
  // index.ts under tsx, or the bundled output in nix-built kolu). We
  // include argv[1] so node finds the same entry that's already running.
  // The actual ARGV separation between "node" and "tsx --import ..." vs
  // a bundled binary is handled by execArgv inheritance.
  const args = [
    ...process.execArgv,
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
  // Don't error if the spawn itself fails — the polling loop below
  // will time out and the kolu-server boot fails cleanly.
  child.on("error", (err) => {
    log.error({ err: err.message }, "supervisor: daemon spawn error");
  });
}

let cached: DaemonHandle | undefined;

/** Snapshot accessor for downstream consumers (status indicator,
 *  LocalTerminalBackend). Returns `undefined` before `ensureDaemon`
 *  has resolved; once a handle is cached, returns the same handle for
 *  the lifetime of this kolu-server process. */
export function getDaemonHandle(): DaemonHandle | undefined {
  return cached;
}

/** Connect to (or spawn-and-connect-to) the local PTY-host daemon.
 *  Returns once the daemon has responded to `system.version`. */
export async function ensureDaemon(): Promise<DaemonHandle> {
  if (cached) return cached;
  const handle = await ensureDaemonImpl();
  cached = handle;
  return handle;
}

async function ensureDaemonImpl(): Promise<DaemonHandle> {
  const { socketPath, logFile } = daemonPaths();
  setDaemonStatus("starting");

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
  // namespace (matches remote-process-monitor's `client.surface.process.kill`).
  const versionInfo = await client.surface.system.version({});
  if (
    !isAgentContractCompatible(
      versionInfo.contractVersion,
      AGENT_CONTRACT_VERSION,
    )
  ) {
    log.warn(
      {
        daemonVersion: versionInfo.contractVersion,
        expected: AGENT_CONTRACT_VERSION,
      },
      "supervisor: agent contract version skew — degraded mode (not yet implemented; PTYs may fail)",
    );
  } else {
    log.info(
      {
        daemonPid: versionInfo.pid,
        contractVersion: versionInfo.contractVersion,
        pkgVersion: versionInfo.pkgVersion,
        socketPath,
      },
      "supervisor: daemon connected",
    );
  }

  let state: "live" | "closed" = "live";
  setDaemonStatus("ready", {
    pid: versionInfo.pid,
    contractVersion: versionInfo.contractVersion,
    socketPath,
  });
  socket.on("close", () => {
    state = "closed";
    log.warn({ socketPath }, "supervisor: daemon socket closed");
    setDaemonStatus("down");
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
