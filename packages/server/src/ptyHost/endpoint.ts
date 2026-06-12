/**
 * The local pty-host endpoint — the ONE owner of daemon liveness and identity.
 *
 * It runs the **boot recycle** (B1's survival-off policy), hands kolu-server a
 * socket-backed `PtyHostClient`, and publishes a `DaemonStatus` on EVERY
 * transition so the rail, and any future degraded-canvas, derive honest state by
 * subscription rather than re-deriving it from a connection value (the #1275
 * identity-staleness trap). R-2 makes this a sibling of an ssh endpoint behind a
 * host-keyed map; B1 has exactly one.
 *
 * Boot recycle — *always recycle, never reuse*: a daemon surviving from a
 * previous server is killed (not adopted), so B1 opens no survival hazard, and
 * every deploy exercises kill → wait-for-real-exit → respawn → connect with zero
 * sessions at stake (the #1034 race, soaked safely). The only fallback is a
 * daemon that refuses to die — then we connect to it rather than spawn a second
 * onto a held gate.
 *
 * Honesty rules it keeps: a contract skew is logged + reflected as `degraded`,
 * NEVER thrown (the launchd "App updated" crash-loop the zest report found); a
 * heartbeat detects mid-session death and flips the state to `dead` (the rail
 * goes red — never the empty-canvas lie). `dispose()` drops our client but does
 * NOT kill the daemon — surviving the server is the whole point.
 */

import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type PtyHostClient,
  PTY_HOST_CONTRACT_VERSION,
  pidGatePathForSocket,
} from "@kolu/pty-host";
import type { ptyHostSurface } from "@kolu/pty-host";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import {
  DEFAULT_DAEMON_STATUS,
  type DaemonState,
  type DaemonStatus,
  EMPTY_PTY_HOST_IDENTITY,
} from "kolu-common/surface";
import type { Logger } from "kolu-shared";
import { LOAD_AWARE_CEILING_MS } from "./loadAwareCeiling.ts";
import { readDaemonPid, spawnDaemon } from "./localDriver.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

export interface EnsureLocalEndpointOpts {
  socketPath: string;
  log: Logger;
  /** Called on every status transition — the composition root forwards it to
   *  the `daemonStatus` surface cell. */
  publishStatus: (status: DaemonStatus) => void;
  /** How long to wait for the freshly-spawned daemon to answer the socket.
   *  Load-aware (a cold tsx daemon under swap takes seconds), like the kill
   *  barrier. */
  connectTimeoutMs?: number;
  /** Heartbeat cadence for mid-session death detection. */
  heartbeatMs?: number;
  /** The server's `--allow-nix-shell-with-env-whitelist` value, forwarded to
   *  the daemon so the process that now owns the PTYs re-applies the same
   *  Nix-devshell env filter (`undefined` ⇒ production passthrough). */
  nixEnvWhitelist?: string;
}

export interface LocalPtyHostEndpoint {
  readonly client: PtyHostClient;
  /** Drop our client + stop the heartbeat. Does NOT kill the daemon. */
  dispose(): void;
}

async function connectWithRetry(
  socketPath: string,
  timeoutMs: number,
): Promise<
  Awaited<ReturnType<typeof unixSocketLink<typeof ptyHostSurface.contract>>>
> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await unixSocketLink<typeof ptyHostSurface.contract>({
        socketPath,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT (socket not bound yet) / ECONNREFUSED (binding in progress) are
      // the expected "daemon still starting" errors; anything else is real.
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `pty-host daemon did not answer at ${socketPath} within ${timeoutMs}ms`,
        );
      }
      await sleep(100);
    }
  }
}

/**
 * The heartbeat transition table, declared in one place rather than scattered
 * across `current.state` conditionals in the timer callback. A successful probe
 * promotes a `degraded` daemon back to `connected`; a failed probe demotes any
 * still-alive daemon to `dead`. Every other (state, probe) pair is a no-op.
 */
function nextHeartbeatState(
  current: DaemonState,
  probe: "ok" | "fail",
): DaemonState {
  if (probe === "ok") return current === "degraded" ? "connected" : current;
  return current === "dead" ? current : "dead";
}

/**
 * Is the gate's pid REALLY this socket's daemon? `readDaemonPid` only proves
 * "some live process owns this pid" (`kill(pid, 0)`), which a stale gate whose
 * pid has been reused by an unrelated same-user process passes — and we must
 * never `SIGTERM` that innocent process. The proof a gate is trustworthy is
 * that the socket answers `system.version()` AND reports the gate's pid (a
 * genuine daemon binds the socket and serves `process.pid` there; the gate
 * stores that same `process.pid`). A connect failure or a pid mismatch ⇒
 * untrusted: we do NOT signal, and let a fresh spawn's pid-gate arbitrate
 * (it reclaims a stale gate, or steps aside for a real foreign holder).
 *
 * The probe is short and self-disposing — on the happy path the very next step
 * tears the daemon down anyway; on the untrusted path we never touched it.
 */
async function gateBelongsToSocketDaemon(
  socketPath: string,
  gatePid: number,
  log: Logger,
): Promise<boolean> {
  let conn: Awaited<ReturnType<typeof connectWithRetry>> | undefined;
  try {
    conn = await connectWithRetry(socketPath, 1_000);
    // Bound the probe itself: a connected-but-wedged daemon (bound socket, no
    // reply) must not hang boot. A timeout reads as "not verifiable" → untrusted.
    const v = await Promise.race([
      conn.client.surface.system.version({}),
      sleep(1_000).then(() => {
        throw new Error("system.version timed out during gate verification");
      }),
    ]);
    return v.pid === gatePid;
  } catch (err) {
    log.warn(
      { err, gatePid, socketPath },
      "could not verify the gate pid against the socket's daemon — treating the gate as untrusted (not signalling it)",
    );
    return false;
  } finally {
    conn?.dispose();
  }
}

export async function ensureLocalEndpoint(
  opts: EnsureLocalEndpointOpts,
): Promise<LocalPtyHostEndpoint> {
  const { socketPath, log, publishStatus } = opts;
  const heartbeatMs = opts.heartbeatMs ?? 5_000;

  let current: DaemonStatus = DEFAULT_DAEMON_STATUS;
  const setStatus = (next: Partial<DaemonStatus>): void => {
    current = { ...current, ...next };
    publishStatus(current);
  };
  setStatus({ state: "connecting" });

  const survivor = readDaemonPid(socketPath);
  // Only signal a pid we have PROVEN is this socket's daemon — a bare live pid
  // from the gate could be an unrelated same-user process that reused the pid
  // of a daemon whose stale gate outlived a reboot (the dev/macOS `tmpdir()`
  // gate isn't wiped like `$XDG_RUNTIME_DIR`). Killing that would be a
  // cross-process friendly-fire.
  if (
    survivor !== null &&
    (await gateBelongsToSocketDaemon(socketPath, survivor, log))
  ) {
    log.info(
      { pid: survivor, socketPath },
      "recycling a surviving pty-host daemon (B1: survival off)",
    );
    try {
      process.kill(survivor, "SIGTERM");
    } catch (err) {
      log.warn(
        { err, pid: survivor },
        "SIGTERM to the surviving daemon failed",
      );
    }
    if (await waitForPidGone(survivor, { log })) {
      spawnDaemon({ socketPath, log, nixEnvWhitelist: opts.nixEnvWhitelist });
    } else {
      log.warn(
        { pid: survivor },
        "surviving daemon would not exit; connecting to it instead of respawning onto a held gate",
      );
    }
  } else {
    // A live-but-untrusted gate (survivor present, yet the socket does not
    // answer as that pid) is a stale gate whose pid was reused by an unrelated
    // process. The fresh daemon's `acquirePidGate` would otherwise see that
    // live pid and step aside as `already-running`, so the real daemon would
    // never start. We have already PROVEN the socket isn't served by this pid,
    // so clear the stale gate here before spawning. (A genuine daemon would
    // have answered the probe and taken the recycle branch above.)
    if (survivor !== null) {
      log.warn(
        { pid: survivor, socketPath },
        "clearing a stale pid-gate (its pid does not serve the socket) so the fresh daemon can acquire it",
      );
      rmSync(pidGatePathForSocket(socketPath), { force: true });
    }
    // No survivor, or a stale gate just cleared: spawn fresh.
    spawnDaemon({ socketPath, log, nixEnvWhitelist: opts.nixEnvWhitelist });
  }

  const conn = await connectWithRetry(
    socketPath,
    opts.connectTimeoutMs ?? LOAD_AWARE_CEILING_MS,
  );

  try {
    const v = await conn.client.surface.system.version({});
    const identity = v.identity ?? EMPTY_PTY_HOST_IDENTITY;
    const compatible = isContractVersionCompatible(
      v.contractVersion,
      PTY_HOST_CONTRACT_VERSION,
    );
    if (!compatible) {
      log.warn(
        { daemon: v.contractVersion, server: PTY_HOST_CONTRACT_VERSION },
        "pty-host contract skew with the surviving daemon — degraded (never a crash)",
      );
    }
    setStatus({
      state: compatible ? "connected" : "degraded",
      startedAt: v.startedAt,
      ...identity,
    });
  } catch (err) {
    log.error({ err }, "pty-host system.version failed at boot");
    setStatus({ state: "degraded" });
  }

  const applyProbe = (probe: "ok" | "fail"): void => {
    const next = nextHeartbeatState(current.state, probe);
    if (next === current.state) return;
    if (next === "dead") {
      log.error(
        { socketPath },
        "pty-host daemon heartbeat failed — marking dead",
      );
    }
    setStatus({ state: next });
  };
  const heartbeat = setInterval(() => {
    void conn.client.surface.system.heartbeat({}).then(
      () => applyProbe("ok"),
      () => applyProbe("fail"),
    );
  }, heartbeatMs);
  heartbeat.unref();

  return {
    client: conn.client,
    dispose() {
      clearInterval(heartbeat);
      conn.dispose();
    },
  };
}
