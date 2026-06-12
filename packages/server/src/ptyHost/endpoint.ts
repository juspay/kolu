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

import { setTimeout as sleep } from "node:timers/promises";
import { type PtyHostClient, PTY_HOST_CONTRACT_VERSION } from "@kolu/pty-host";
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
  if (survivor !== null) {
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
      spawnDaemon({ socketPath, log });
    } else {
      log.warn(
        { pid: survivor },
        "surviving daemon would not exit; connecting to it instead of respawning onto a held gate",
      );
    }
  } else {
    spawnDaemon({ socketPath, log });
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
