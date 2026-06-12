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
 * Either way the daemon's stdout/stderr land in one file (`daemonLogPath`,
 * beside the socket) — the same place on every platform, so its logs are never
 * `/dev/null` and never platform-guesswork.
 *
 * The daemon binary is `$KOLU_PTY_HOST_BIN` — the nix `kolu-pty-host` wrapper in
 * production/e2e (it bakes the identity env it serves), the tsx dev launcher
 * under `just dev`. It is required, never guessed: a wrong daemon binary is the
 * kind of drift that fails silently, so we fail loud if it is unset.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  NIX_ENV_WHITELIST_ENV,
  pidGatePathForSocket,
  pidIsAlive,
  readPidGate,
} from "@kolu/pty-host";
import type { Logger } from "kolu-shared";

/** The daemon's log file — a sibling of its socket, in the same private dir,
 *  the SAME path on every platform. The daemon's stdout+stderr land here:
 *  inherited-fd on the detached path (macOS / dev), `StandardOutput=append` on
 *  the systemd-run path (Linux) — so an operator tails one place regardless of
 *  launch mechanism. (It closes the gap a live macOS deploy surfaced — `stdio:
 *  "ignore"` had discarded the daemon's whole voice into `/dev/null`.)
 *  Append-mode: a recycle interleaves the old and new daemon's lines — each
 *  tagged with its own pid + timestamp — rather than truncating the prior tail. */
export function daemonLogPath(socketPath: string): string {
  return join(dirname(socketPath), "pty-host.log");
}

function daemonBin(): string {
  const bin = process.env.KOLU_PTY_HOST_BIN;
  if (!bin) {
    throw new Error(
      "KOLU_PTY_HOST_BIN is unset — the nix wrapper bakes it (production/e2e) and `just dev` exports the tsx launcher. Refusing to guess the daemon binary.",
    );
  }
  return bin;
}

/** The env the daemon inherits — the server's, MINUS its node flags, PLUS the
 *  Nix-devshell whitelist decision. The daemon is a fresh, long-lived process
 *  with its own (nix-baked) identity env; it must not inherit the server's
 *  `NODE_OPTIONS`, which can carry the server's heapsnapshot flags
 *  (`KOLU_DIAG_DIR`), an `--inspect`, or — under vitest — a module loader that
 *  breaks an unrelated child. The brief's "dev-flag exec-arg filter".
 *
 *  The PTYs live in the daemon now, so its `cleanEnv()` — not the server's — is
 *  the one that filters the shells' env. The server's
 *  `--allow-nix-shell-with-env-whitelist` decision is module-local to the
 *  server process, so we forward it explicitly via `KOLU_NIX_ENV_WHITELIST` for
 *  the daemon to re-apply (see `daemonMain.ts`). Absent ⇒ production
 *  passthrough; an empty string (forward nothing) is forwarded faithfully.
 *  (Covers the detached macOS/dev path; the systemd-run unit gets a clean env
 *  regardless — see DAEMON_FORWARD_ENV.) */
function daemonEnv(nixEnvWhitelist: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (nixEnvWhitelist !== undefined) {
    env[NIX_ENV_WHITELIST_ENV] = nixEnvWhitelist;
  }
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
  // The Nix-devshell whitelist decision (set by `daemonEnv` below). Forwarded
  // through the transient unit's clean env so the systemd-run path filters PTY
  // shells identically to the detached path. IN_NIX_SHELL too: the daemon's
  // production safety net (crash if in a nix shell without a whitelist) needs
  // it visible — but only matters in dev, where it is already in the env.
  NIX_ENV_WHITELIST_ENV,
  "IN_NIX_SHELL",
] as const;

/** Launch the surviving pty-host daemon bound to `socketPath`. Returns once the
 *  spawn is *issued* — readiness is the endpoint's connect-retry, not this call.
 *  The daemon acquires its own pid-gate and binds the socket.
 *
 *  `nixEnvWhitelist` is the server's `--allow-nix-shell-with-env-whitelist`
 *  value, forwarded so the daemon (which now owns the PTYs) re-applies the same
 *  filter — `undefined` in production (passthrough). */
export function spawnDaemon(opts: {
  socketPath: string;
  log: Logger;
  nixEnvWhitelist: string | undefined;
}): void {
  const { socketPath, log, nixEnvWhitelist } = opts;
  const bin = daemonBin();
  const args = ["--pty-host-socket", socketPath];
  const env = daemonEnv(nixEnvWhitelist);

  // The daemon's log file — the SAME path on EVERY platform, so an operator
  // tails one place no matter how the daemon was launched. We log the path so it
  // never has to be guessed. (On Linux journald *additionally* records the
  // transient unit's lifecycle, but the daemon's own voice lands in this file.)
  const logPath = daemonLogPath(socketPath);
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });

  // The transient unit runs in the user manager's clean env, so forward the
  // keys the daemon needs (PATH, runtime dirs, identity, the Nix whitelist) via
  // `--setenv`. Derive the values from `env` (not `process.env`) so the
  // whitelist decision injected above reaches the transient unit too. The unit's
  // stdout+stderr append to `logPath` (same as the detached path) rather than
  // going only to journald — consistency over platform-native.
  if (process.platform === "linux" && process.env.INVOCATION_ID) {
    const unit = `kolu-pty-host-${randomUUID().slice(0, 8)}`;
    const setenv = DAEMON_FORWARD_ENV.filter((k) => env[k] !== undefined).map(
      (k) => `--setenv=${k}=${env[k]}`,
    );
    log.info(
      { socketPath, unit, bin, logPath },
      "spawning pty-host daemon (systemd-run --user, own cgroup)",
    );
    const child = spawn(
      "systemd-run",
      [
        "--user",
        "--collect",
        `--unit=${unit}`,
        `--property=StandardOutput=append:${logPath}`,
        `--property=StandardError=append:${logPath}`,
        ...setenv,
        bin,
        ...args,
      ],
      { stdio: "ignore", env },
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

  // Detached (macOS / dev-Linux without systemd): there is no journald, so the
  // daemon's stdout+stderr go straight to `logPath` via the inherited fd. The
  // child dup's it; close our copy after spawn so the long-lived server never
  // leaks it.
  const logFd = openSync(logPath, "a");
  log.info({ socketPath, bin, logPath }, "spawning pty-host daemon (detached)");
  const child = spawn(bin, args, {
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env,
  });
  child.on("error", (err) =>
    log.error({ err }, "failed to launch the pty-host daemon"),
  );
  child.unref();
  closeSync(logFd);
}

/** The pid of a daemon already holding the socket's gate, or `null` if the gate
 *  is absent/stale (no live holder). The read side of the single-instance gate;
 *  the daemon owns the write side. */
export function readDaemonPid(socketPath: string): number | null {
  const pid = readPidGate(pidGatePathForSocket(socketPath));
  return pid !== null && pidIsAlive(pid) ? pid : null;
}
