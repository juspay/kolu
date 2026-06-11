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
import { PTY_HOST_CONTRACT_VERSION, ptyHostSurface } from "@kolu/pty-host";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { type Logger, pidIsAlive, readPidGate } from "kolu-shared";
import { type IsAlive, waitForPidGone } from "./waitForPidGone.ts";

type Conn = UnixSocketConnection<typeof ptyHostSurface.contract>;

/** The restart flow's own observable state (connected/restarting/degraded),
 *  asserted by the handle's unit tests. No UI consumes it yet — the rail derives
 *  its currency from staleKey, and the DegradedCanvas consumer is an
 *  acknowledged follow-up. */
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
   *  old daemon won't die or the new one won't come up — on `"failed"` the
   *  orchestration layer keeps the saved session and shows the DegradedCanvas. */
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
  /** Is the connected daemon's pty-host contract compatible with this build?
   *  Default: read `system.version()` over the socket and compare with
   *  `isContractVersionCompatible`. Injectable so the skew→restart path is
   *  unit-testable without a second-build daemon. */
  checkContract?: () => Promise<boolean>;
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

  /** Is the live daemon's pty-host contract compatible with this build? */
  const checkContract =
    deps.checkContract ??
    (async (): Promise<boolean> => {
      try {
        const { contractVersion } = await conn.client.surface.system.version(
          {},
        );
        return isContractVersionCompatible(
          contractVersion,
          PTY_HOST_CONTRACT_VERSION,
        );
      } catch (err) {
        // Can't read it → don't force a destructive restart; let the runtime
        // surface any genuine incompatibility. (A real skew also trips here, but
        // assuming-compatible is the less-destructive default for an unreadable
        // version.)
        deps.log.warn(
          { err },
          "could not read surviving daemon's contract version — assuming compatible",
        );
        return true;
      }
    });

  /** The daemon-process restart (kill → wait → respawn → reconnect), shared by
   *  the handle's `restart()` and the boot-time contract-skew recovery. */
  async function doRestart(): Promise<"ok" | "failed"> {
    state = "restarting";
    const oldPid = readPidGate(deps.pidPath);
    // Hold the old connection until a replacement is actually live. If the old
    // daemon won't die, it's STILL the connection we want — disposing it up
    // front would strand the handle on a dead reference even though the daemon
    // is reachable. So dispose only at the point we commit to a swap.
    if (oldPid !== null) {
      kill(oldPid);
      const gone = await waitForPidGone(oldPid, {
        timeoutMs: pidGoneTimeoutMs,
        pollMs,
        isAlive,
      });
      if (gone === "timeout") {
        // The old daemon outlived the kill — refuse to respawn over it. The
        // existing `conn` still points at that live daemon, so the handle stays
        // usable (terminals keep working); surface degraded so the UI can offer
        // a retry, but DON'T tear down a working connection.
        deps.log.error(
          { pid: oldPid },
          "old pty-host daemon did not exit — refusing to respawn over it; keeping the live connection",
        );
        state = "degraded";
        return "failed";
      }
    }
    // The old daemon is gone (or there was none) — now we commit to the swap.
    conn.dispose();
    await deps.spawnDaemon();
    try {
      conn = await connectWithRetry(deps.socketPath, connectTimeoutMs, pollMs);
    } catch (err) {
      // Old daemon dead, new one never came up — no daemon is reachable. This
      // is the genuinely degraded state: a retried `restart()` re-reads the gate
      // and tries again (a slow respawn may since have bound the socket), so the
      // handle is recoverable in place — a browser reload is NOT the recovery
      // (the server-side handle persists across a reload).
      deps.log.error({ err }, "respawned pty-host daemon never came up");
      state = "degraded";
      return "failed";
    }
    state = "connected";
    deps.log.info({}, "pty-host daemon restarted and reconnected");
    return "ok";
  }

  // Contract-skew guard (field report on #1275): a deploy can leave an OLDER
  // daemon holding the socket. If its pty-host wire contract is incompatible
  // with this build, adopting it would fail RPCs at runtime. Prefer a controlled
  // restart — a fresh daemon at our contract (the rare terminal-loss a pty-host
  // contract change costs; the saved session still restores) — over a crash or
  // silent RPC failures. Only a SURVIVOR can skew; a daemon we just spawned is
  // our own build.
  if (survivor !== null && !(await checkContract())) {
    deps.log.warn(
      { contractVersion: PTY_HOST_CONTRACT_VERSION },
      "surviving pty-host daemon speaks an incompatible contract — restarting it to this build",
    );
    await doRestart();
  }

  return {
    client: reconnectingClient(() => conn.client),
    pid: () => readPidGate(deps.pidPath),
    state: () => state,
    restart: doRestart,
    dispose() {
      conn.dispose();
    },
  };
}
