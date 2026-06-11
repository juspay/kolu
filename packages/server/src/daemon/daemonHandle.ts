/**
 * The server's handle on the pty-host daemon: it connects to the daemon over
 * the unix socket, hands `LocalTerminalBackend` a *stable* client reference,
 * and owns the daemon-process side of the restart sequence (kill → wait → spawn
 * → reconnect).
 *
 * Two distinct cross-process events, only one of which this handle sees:
 *   - A **server restart** (a deploy) is a fresh server process — it just calls
 *     `ensureDaemon` at boot and reattaches to the surviving daemon. No handle
 *     outlives it.
 *   - A **daemon restart** (the user picks up a new pty-host build, or a forced
 *     recovery) happens *under a live server*. The socket connection is torn
 *     down and replaced — but `local.ts` holds one client reference for the
 *     process's life. So the handle's `client` is a **reconnecting proxy**: it
 *     resolves the current live connection per call, so a restart swaps the
 *     transport underneath without invalidating any holder.
 *
 * In-flight streams (an attach, a provider tap) still break when the daemon
 * dies — that is unavoidable — and the reattach pass re-subscribes them against
 * the fresh daemon. The proxy guarantees only that *new* calls always reach the
 * live daemon.
 */
import type { PtyHostClient } from "@kolu/pty-host";
import { ptyHostSurface } from "@kolu/pty-host";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { type Logger, pidIsAlive, readPidGate } from "kolu-shared";
import { type IsAlive, waitForPidGone } from "./waitForPidGone.ts";

type Conn = UnixSocketConnection<typeof ptyHostSurface.contract>;

/** Honest daemon liveness, surfaced to the rail / DegradedCanvas. */
export type DaemonState = "connected" | "restarting" | "degraded";

export interface DaemonHandle {
  /** A reconnecting client — stable for the process's life, even across a
   *  daemon restart. */
  readonly client: PtyHostClient;
  /** The live daemon's pid, or null if the gate is absent/stale. */
  pid(): number | null;
  state(): DaemonState;
  /** The daemon-process half of the composed restart: kill the old daemon,
   *  wait for its real exit (the lock-release barrier), spawn a fresh one, and
   *  reconnect. Returns `"failed"` (and leaves `state()==="degraded"`) if the
   *  old daemon won't die or the new one won't come up — the orchestration
   *  layer then keeps the saved session and shows the DegradedCanvas. */
  restart(): Promise<"ok" | "failed">;
  /** Drop the connection (server shutdown). Does NOT stop the daemon — that is
   *  the point: it survives. */
  dispose(): void;
}

export interface DaemonHandleDeps {
  socketPath: string;
  pidPath: string;
  log: Logger;
  /** Launch the daemon process (detached / `systemd-run`). Resolves once
   *  launched; the daemon binds the socket asynchronously, so we connect-retry. */
  spawnDaemon: () => Promise<void>;
  /** Terminate the daemon by pid. Default: `SIGTERM`. */
  killDaemon?: (pid: number) => void;
  /** Liveness probe for the wait barrier — injectable for tests. */
  isAlive?: IsAlive;
  /** How long to wait for the socket to come up after a spawn. */
  connectTimeoutMs?: number;
  /** Load-aware ceiling for the old daemon's exit (a thrashing prod box). */
  pidGoneTimeoutMs?: number;
  pollMs?: number;
}

const DEFAULTS = {
  connectTimeoutMs: 30_000,
  pidGoneTimeoutMs: 60_000,
  pollMs: 100,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultKill = (pid: number): void => {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone — the wait barrier will see ESRCH immediately.
  }
};

/** Connect to the daemon's socket, retrying past the not-yet-bound window
 *  (`ECONNREFUSED`/`ENOENT`) until it answers or the ceiling elapses. */
async function connectWithRetry(
  socketPath: string,
  timeoutMs: number,
  pollMs: number,
): Promise<Conn> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await unixSocketLink<typeof ptyHostSurface.contract>({
        socketPath,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" && code !== "ENOENT") throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `pty-host daemon socket ${socketPath} never came up within ${timeoutMs}ms`,
        );
      }
      await sleep(pollMs);
    }
  }
}

/**
 * A reconnecting proxy over the pty-host contract client. Every leaf call
 * resolves the *current* connection's client and walks the same property path,
 * so swapping the underlying connection (a daemon restart) is transparent to
 * holders.
 */
function reconnectingClient(getClient: () => PtyHostClient): PtyHostClient {
  const at = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) =>
        typeof prop === "string" ? at([...path, prop]) : undefined,
      apply: (_t, _this, args) => {
        // biome-ignore lint/suspicious/noExplicitAny: walking an oRPC client by string path is inherently dynamic.
        let target: any = getClient();
        for (const key of path) target = target[key];
        return target(...args);
      },
    });
  return at([]) as PtyHostClient;
}

/**
 * Connect to the daemon — reattaching to a survivor if the gate names a live
 * one, else spawning a fresh daemon first — and return a handle whose client
 * stays valid across restarts.
 */
export async function ensureDaemon(
  deps: DaemonHandleDeps,
): Promise<DaemonHandle> {
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
  const pidGoneTimeoutMs = deps.pidGoneTimeoutMs ?? DEFAULTS.pidGoneTimeoutMs;
  const pollMs = deps.pollMs ?? DEFAULTS.pollMs;
  const isAlive = deps.isAlive ?? pidIsAlive;
  const kill = deps.killDaemon ?? defaultKill;

  const survivor = readPidGate(deps.pidPath);
  if (survivor === null) {
    deps.log.info({}, "no surviving pty-host daemon — spawning one");
    await deps.spawnDaemon();
  } else {
    deps.log.info(
      { pid: survivor },
      "reattaching to surviving pty-host daemon",
    );
  }

  let conn = await connectWithRetry(deps.socketPath, connectTimeoutMs, pollMs);
  let state: DaemonState = "connected";

  return {
    client: reconnectingClient(() => conn.client),
    pid: () => readPidGate(deps.pidPath),
    state: () => state,
    async restart() {
      state = "restarting";
      const oldPid = readPidGate(deps.pidPath);
      conn.dispose();
      if (oldPid !== null) {
        kill(oldPid);
        const gone = await waitForPidGone(oldPid, {
          timeoutMs: pidGoneTimeoutMs,
          pollMs,
          isAlive,
        });
        if (gone === "timeout") {
          deps.log.error(
            { pid: oldPid },
            "old pty-host daemon did not exit — refusing to respawn over it",
          );
          state = "degraded";
          return "failed";
        }
      }
      await deps.spawnDaemon();
      try {
        conn = await connectWithRetry(
          deps.socketPath,
          connectTimeoutMs,
          pollMs,
        );
      } catch (err) {
        deps.log.error({ err }, "respawned pty-host daemon never came up");
        state = "degraded";
        return "failed";
      }
      state = "connected";
      deps.log.info({}, "pty-host daemon restarted and reconnected");
      return "ok";
    },
    dispose() {
      conn.dispose();
    },
  };
}
