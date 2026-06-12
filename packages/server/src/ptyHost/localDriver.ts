/**
 * The LOCAL reach mechanics for the surviving pty-host daemon — how kolu-server
 * launches it and discovers it. This is the per-platform, per-quirk layer; R-2's
 * ssh driver is its sibling behind the endpoint, reaching a remote host instead.
 *
 * Survival is by cgroup, not luck:
 *   - Linux under systemd (`INVOCATION_ID` set ⇒ we are a unit): a transient
 *     `systemd-run --user` SERVICE lands in its OWN cgroup, so the kolu service's
 *     cgroup teardown on the next deploy (`KillMode=control-group` walks cgroup
 *     membership) does not reap the daemon — the #1031 Linux failure a plain
 *     detached child hits on cgroup-v2. A per-spawn unique `--unit` name avoids a
 *     dead unit lingering loaded (#1275); `--collect` GCs it on exit.
 *   - macOS, or Linux NOT under systemd (dev): a detached + `unref`'d child,
 *     which already reparents to launchd/init and outlives the server.
 *
 * The daemon binary is `$KOLU_PTY_HOST_BIN` — the nix `kolu-pty-host` wrapper in
 * production/e2e (it bakes the identity env it serves), the tsx dev launcher
 * under `just dev`. It is required, never guessed: a wrong daemon binary is the
 * kind of drift that fails silently, so we fail loud if it is unset.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pidGatePathForSocket, pidIsAlive, readPidGate } from "@kolu/pty-host";
import type { Logger } from "kolu-shared";

function daemonBin(): string {
  const bin = process.env.KOLU_PTY_HOST_BIN;
  if (!bin) {
    throw new Error(
      "KOLU_PTY_HOST_BIN is unset — the nix wrapper bakes it (production/e2e) and `just dev` exports the tsx launcher. Refusing to guess the daemon binary.",
    );
  }
  return bin;
}

/** The env the daemon inherits — the server's, MINUS its node flags. The daemon
 *  is a fresh, long-lived process with its own (nix-baked) identity env; it must
 *  not inherit the server's `NODE_OPTIONS`, which can carry the server's
 *  heapsnapshot flags (`KOLU_DIAG_DIR`), an `--inspect`, or — under vitest — a
 *  module loader that breaks an unrelated child. The brief's "dev-flag exec-arg
 *  filter". (Covers the detached macOS/dev path; the systemd-run unit gets a
 *  clean env regardless — see DAEMON_FORWARD_ENV.) */
function daemonEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}

/** The env keys the systemd-run transient unit needs forwarded. A `--user`
 *  transient service runs in the user manager's CLEAN environment, so without
 *  these the daemon can't find its runtime: `PATH` (the dev launcher resolves
 *  `tsx` from it, and the daemon's shells inherit it), `HOME`/`USER`/`LOGNAME`
 *  and `XDG_RUNTIME_DIR` (shells + the socket/shellDir), and the identity env
 *  the daemon serves (baked into the nix wrapper in prod, but the dev launcher
 *  relies on these being present). NODE_OPTIONS is deliberately NOT forwarded
 *  (the dev-flag filter). */
const DAEMON_FORWARD_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "XDG_RUNTIME_DIR",
  "KOLU_PTY_HOST_BUILD_ID",
  "KOLU_COMMIT_HASH",
  "KOLU_VERSION",
] as const;

/** Launch the surviving pty-host daemon bound to `socketPath`. Returns once the
 *  spawn is *issued* — readiness is the endpoint's connect-retry, not this call.
 *  The daemon acquires its own pid-gate and binds the socket. */
export function spawnDaemon(opts: { socketPath: string; log: Logger }): void {
  const { socketPath, log } = opts;
  const bin = daemonBin();
  const args = ["--pty-host-socket", socketPath];

  // The transient unit runs in the user manager's clean env, so forward the
  // keys the daemon needs (PATH, runtime dirs, identity) via `--setenv`.
  if (process.platform === "linux" && process.env.INVOCATION_ID) {
    const unit = `kolu-pty-host-${randomUUID().slice(0, 8)}`;
    const setenv = DAEMON_FORWARD_ENV.filter(
      (k) => process.env[k] !== undefined,
    ).map((k) => `--setenv=${k}=${process.env[k]}`);
    log.info(
      { socketPath, unit, bin },
      "spawning pty-host daemon (systemd-run --user, own cgroup)",
    );
    const child = spawn(
      "systemd-run",
      ["--user", "--collect", `--unit=${unit}`, ...setenv, bin, ...args],
      { stdio: "ignore", env: daemonEnv() },
    );
    child.on("error", (err) =>
      log.error(
        { err, unit },
        "systemd-run failed to launch the pty-host daemon",
      ),
    );
    child.unref();
    return;
  }

  log.info({ socketPath, bin }, "spawning pty-host daemon (detached)");
  const child = spawn(bin, args, {
    stdio: "ignore",
    detached: true,
    env: daemonEnv(),
  });
  child.on("error", (err) =>
    log.error({ err }, "failed to launch the pty-host daemon"),
  );
  child.unref();
}

/** The pid of a daemon already holding the socket's gate, or `null` if the gate
 *  is absent/stale (no live holder). The read side of the single-instance gate;
 *  the daemon owns the write side. */
export function readDaemonPid(socketPath: string): number | null {
  const pid = readPidGate(pidGatePathForSocket(socketPath));
  return pid !== null && pidIsAlive(pid) ? pid : null;
}
