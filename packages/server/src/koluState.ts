/**
 * Daemon-side paths under `$KOLU_STATE_DIR`. The env var itself is
 * resolved (and required) by `./state.ts` — every kolu entry point
 * (nix wrapper, `pnpm dev`, test harness) already sets it, and a bare
 * launch is rejected upstream. The agent process and the supervisor
 * read the same env so they pick the same directory.
 *
 * Layout under `$KOLU_STATE_DIR`:
 *   agent.pid   — text file with the daemon's PID (single-instance gate)
 *   agent.sock  — unix domain socket the daemon listens on
 *   agent.log   — pino/JSON-lines log written by the daemon
 *
 * `daemonPaths()` is a pure path computation — no I/O. Callers are
 * responsible for ensuring the parent directory exists (the existing
 * `Conf` store under the same path already does this at process start).
 */
import { join } from "node:path";

function requireStateDir(): string {
  const dir = process.env.KOLU_STATE_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_STATE_DIR must be set. The nix-built kolu wrapper, " +
        "`pnpm dev`, and the test harness each set their own — bare " +
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
    pidFile: join(stateDir, "agent.pid"),
    socketPath: join(stateDir, "agent.sock"),
    logFile: join(stateDir, "agent.log"),
  };
}
