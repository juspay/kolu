/**
 * The surviving pty-host daemon: a standalone process that binds the unix
 * socket, serves the full `ptyHostSurface`, and holds the single-instance gate
 * until death — so a kolu-server restart (a deploy) reconnects to the *same*
 * PTYs instead of killing them. kolu-server spawns it (detached, or via
 * `systemd-run` on a systemd host so it outlives `systemctl restart`); the
 * server and kolu-tui are then both just socket clients of it.
 *
 * This is daemon *behaviour*, so it lives in the `@kolu/pty-host` closure the
 * staleKey hashes — a change here flips the staleKey and the rail's
 * update-pending nudge, exactly as A2 designed. The thin process entry that
 * drives it (signal handling, keep-alive) is server-side glue, deliberately
 * outside the hashed closure.
 */
import {
  acquirePidGate,
  type KoluRoot,
  koluRootFor,
  type Logger,
} from "kolu-shared";
import { createInProcessPtyHost } from "./inProcessPtyHost.ts";
import { servePtyHostOverUnixSocket } from "./serveOverSocket.ts";
import { getPtyHostPidPath, getPtyHostSocketPath } from "./socketPath.ts";

export interface RunPtyHostDaemonOpts {
  /** Override the socket path; pairs with the derived pid path. Default: the
   *  shared rendezvous (`getPtyHostSocketPath`). */
  socketPath?: string;
  /** Override the pid-gate path. Default: derived from `socketPath`. */
  pidPath?: string;
  /** The daemon's own temp root (shell rc injection). Default:
   *  `koluRootFor("pty-host")`. Injected so tests stay off the shared path. */
  root?: KoluRoot;
  /** The pty-host package version, surfaced on `system.version`. */
  version: string;
  log: Logger;
}

export interface PtyHostDaemon {
  readonly socketPath: string;
  readonly pidPath: string;
  /** Stop serving, release the gate, and drop the temp root. Idempotent and
   *  safe from a signal handler. */
  close(): void;
}

export type RunPtyHostDaemonResult =
  /** We own the gate and the socket is listening. */
  | { kind: "serving"; daemon: PtyHostDaemon }
  /** A live daemon already holds the gate — stand down; the server reattaches
   *  to that survivor over the socket. */
  | { kind: "already-running"; pid: number }
  /** We owned the gate but could not bind the socket (refusal already logged);
   *  the gate has been released so a retry isn't blocked. */
  | { kind: "serve-failed"; outcome: string };

/**
 * Start the daemon. Single-instance is enforced by the pid-gate (whose liveness
 * IS the lock), so a second invocation against a live daemon returns
 * `already-running` rather than fighting over the socket. The socket bind is
 * the second gate: a refusal releases the pid-gate and reports `serve-failed`,
 * never a half-acquired state.
 */
export async function runPtyHostDaemon(
  opts: RunPtyHostDaemonOpts,
): Promise<RunPtyHostDaemonResult> {
  const socketPath = opts.socketPath ?? getPtyHostSocketPath();
  const pidPath = opts.pidPath ?? getPtyHostPidPath(opts.socketPath);
  const root = opts.root ?? koluRootFor("pty-host");
  const { log, version } = opts;

  const acquired = acquirePidGate(pidPath);
  if (acquired.kind === "held") {
    log.info(
      { pidPath, pid: acquired.byPid },
      "pty-host daemon already running — standing down",
    );
    return { kind: "already-running", pid: acquired.byPid };
  }
  const { gate } = acquired;

  root.ensure();
  const host = createInProcessPtyHost({
    log,
    shellDir: root.shellDir,
    version,
  });
  const listener = await servePtyHostOverUnixSocket({
    socketPath,
    router: host.servedRouter,
    log,
  });
  if (listener.outcome !== "listening") {
    gate.release();
    return { kind: "serve-failed", outcome: listener.outcome };
  }

  let closed = false;
  log.info({ socketPath, pidPath, pid: gate.pid }, "pty-host daemon serving");
  return {
    kind: "serving",
    daemon: {
      socketPath,
      pidPath,
      close() {
        if (closed) return;
        closed = true;
        listener.close();
        gate.release();
        root.cleanup();
        log.info({ socketPath }, "pty-host daemon stopped");
      },
    },
  };
}
