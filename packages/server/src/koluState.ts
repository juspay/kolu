/**
 * Persistent state directory — the home for daemon artifacts that
 * outlive a kolu-server process.
 *
 * Distinct from `koluRoot` (the ephemeral per-process scratch root
 * under `$XDG_RUNTIME_DIR`). This directory is where the daemon's
 * PID file, unix socket, and log file live; dev and prod kolu-server
 * instances pick different directories so their daemons can't
 * collide.
 *
 * Resolution order:
 *  1. `$KOLU_STATE_DIR` — explicit override (set by `just dev` to
 *     `./.kolu-state` at the repo root).
 *  2. Linux: `$XDG_STATE_HOME/kolu` or `~/.local/state/kolu`.
 *  3. macOS: `~/Library/Application Support/kolu` (unless
 *     `XDG_STATE_HOME` is set, then the Linux rule applies).
 *  4. Other unixes: `~/.kolu` as a last resort.
 *
 * The directory is created with mode 0700 on first access.
 */
import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

function resolvePlatformDefault(): string {
  const home = homedir();
  const xdgState = process.env.XDG_STATE_HOME;
  if (xdgState) return join(xdgState, "kolu");
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "kolu");
  }
  if (platform() === "linux") {
    return join(home, ".local", "state", "kolu");
  }
  return join(home, ".kolu");
}

let cached: string | undefined;

/** Resolve the state dir for this process. Idempotent — the chosen
 *  path is cached for the process lifetime. Creates the directory if
 *  missing. */
export function koluStateDir(): string {
  if (cached) return cached;
  const override = process.env.KOLU_STATE_DIR;
  cached = override ? resolve(override) : resolvePlatformDefault();
  mkdirSync(cached, { recursive: true, mode: 0o700 });
  return cached;
}

/** Daemon-related paths under the state dir. Computed lazily so
 *  callers that never touch the daemon don't materialize them. */
export function daemonPaths(): {
  pidFile: string;
  socketPath: string;
  logFile: string;
} {
  const dir = koluStateDir();
  return {
    pidFile: join(dir, "agent.pid"),
    socketPath: join(dir, "agent.sock"),
    logFile: join(dir, "agent.log"),
  };
}
