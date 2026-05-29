/**
 * Daemon-side paths under `$KOLU_STATE_DIR` — the **stable** per-state-dir
 * location the `kolu --stdio` PTY-host daemon binds to and the supervisor
 * connects to.
 *
 * Distinct from `./koluRoot.ts`, which is an *ephemeral* per-server-instance
 * tree (keyed by the server's startup UUID, under `$XDG_RUNTIME_DIR`) for
 * shell rc files + scratch. The daemon socket must instead live at a fixed
 * path so a *restarted* kolu-server finds the *same* running daemon — that
 * stable key is `$KOLU_STATE_DIR`, the directory kolu already uses for
 * sessions / preferences / run-id. R4c adds `pty-host.{pid,sock,log}`
 * alongside.
 *
 * `$KOLU_STATE_DIR` is the dev/prod multiplexer: `just dev` uses
 * `./.kolu-state`, the production install uses `~/.config/kolu`, the test
 * harness uses a per-worker tmp dir — each gets its own daemon, socket, and
 * pid file, so they never collide. The env var is set by every kolu entry
 * point (nix wrapper, dev, test harness); a bare launch is rejected here.
 *
 * `daemonPaths()` is a pure path computation — no I/O. The parent directory
 * is created by the existing `Conf` state store at process start.
 */
import { join } from "node:path";

function requireStateDir(): string {
  const dir = process.env.KOLU_STATE_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_STATE_DIR must be set. The nix-built kolu wrapper, " +
        "`just dev`, and the test harness each set their own — bare " +
        "launches are rejected.",
    );
  }
  return dir;
}

/** Daemon-related paths under `$KOLU_STATE_DIR`. */
export function daemonPaths(): {
  stateDir: string;
  pidFile: string;
  socketPath: string;
  logFile: string;
} {
  const stateDir = requireStateDir();
  return {
    stateDir,
    pidFile: join(stateDir, "pty-host.pid"),
    socketPath: join(stateDir, "pty-host.sock"),
    logFile: join(stateDir, "pty-host.log"),
  };
}
