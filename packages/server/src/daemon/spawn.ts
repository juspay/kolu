/**
 * Spawn the pty-host daemon as a process that OUTLIVES this server.
 *
 * Two launch shapes, chosen by environment:
 *   - **Under systemd** (`INVOCATION_ID` set — i.e. `kolu.service`): launch via
 *     `systemd-run --user` so the daemon lands in its *own* transient cgroup and
 *     survives `systemctl restart kolu.service`. A plain detached child does NOT
 *     survive on cgroup-v2 — `KillMode=control-group` walks cgroup membership,
 *     which was the #1031 Linux failure.
 *   - **Otherwise** (dev, the e2e harness, macOS/launchd): a plain
 *     `detached + unref` child, reparented to init, which already survives the
 *     parent's death everywhere.
 *
 * The command is built FRESH (the daemon entry + the runtime's own loader args),
 * never by copying this server's argv — so dev-only flags
 * (`--allow-nix-shell-with-env-whitelist`) can't leak into the daemon. The
 * resolved socket path is passed through `KOLU_PTY_HOST_SOCKET` so the daemon
 * binds exactly where the server will dial, and the build-identity env
 * (`KOLU_PTY_HOST_BUILD_ID` / `KOLU_COMMIT_HASH`) is inherited unchanged.
 *
 * Under systemd the daemon's env can't ride `spawn`'s `env` (that reaches only
 * the `systemd-run` CLIENT — the transient unit runs in the user manager's clean
 * environment). The daemon-needed runtime vars are therefore forwarded into the
 * unit explicitly via `--setenv=` (`DAEMON_ENV_KEYS`); the override socket lands
 * the same way so `--pty-host-socket` doesn't silently spawn on the default.
 */
import { spawn, type StdioOptions } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "kolu-shared";
import { DAEMON_ENV_KEYS } from "./env.ts";

export interface SpawnDaemonOpts {
  /** The resolved socket path the daemon must bind (passed via env). */
  socketPath: string;
  log: Logger;
}

/** The daemon command. Prod uses the nix-built `kolu-daemon` (`KOLU_DAEMON_BIN`);
 *  dev/test re-execs this runtime (tsx) against the daemon entry, re-applying
 *  the loader args so the `.ts` entry runs. */
function resolveDaemonCommand(): { cmd: string; args: string[] } {
  const bin = process.env.KOLU_DAEMON_BIN;
  if (bin) return { cmd: bin, args: [] };
  const entry = fileURLToPath(new URL("./daemonMain.ts", import.meta.url));
  return { cmd: process.execPath, args: [...process.execArgv, entry] };
}

/** `--setenv=K=V` for every daemon-needed var that is actually present in
 *  `env`, so the transient unit comes up with the same dynamic config the
 *  server resolved. Absent vars are skipped (no empty overrides). */
function setenvArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  for (const key of DAEMON_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "")
      args.push(`--setenv=${key}=${value}`);
  }
  return args;
}

/** Open a daemon log next to the socket (its dir is the 0700 runtime root), so
 *  a detached daemon's output is diagnosable instead of dropped on the floor. */
function openDaemonLog(socketPath: string): number {
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return openSync(join(dir, "pty-host-daemon.log"), "a", 0o600);
}

/** The transient unit name, unique PER SOCKET *and* PER SPAWN. The socket hash
 *  keeps two systemd-backed kolu instances (distinct sockets) from colliding;
 *  the per-spawn `randomBytes` generation tag keeps a SAME-socket restart from
 *  reusing a name whose old transient unit hasn't finished `--collect` teardown
 *  yet. The process exiting (what `waitForPidGone` observes) and systemd GC'ing
 *  the unit OBJECT are distinct events, so a respawn can fire while the old unit
 *  name is still loaded — `systemd-run --unit=<same>` then fails with "unit
 *  already exists" and the restart spuriously degrades. A fresh generation tag
 *  sidesteps that window entirely; the pid gate stays the logical singleton
 *  guard, so a per-spawn unit name costs nothing. (systemd unit names allow
 *  `[A-Za-z0-9:_.\-]`, which hex satisfies.) */
function daemonUnitName(socketPath: string): string {
  const socketTag = createHash("sha256")
    .update(socketPath)
    .digest("hex")
    .slice(0, 12);
  const generationTag = randomBytes(4).toString("hex");
  return `kolu-pty-host-${socketTag}-${generationTag}`;
}

/** Launch the daemon. Returns once spawned; the daemon binds the socket on its
 *  own tick, so the caller (`DaemonHandle`) connect-retries. */
export async function spawnDaemonProcess(opts: SpawnDaemonOpts): Promise<void> {
  const { cmd, args } = resolveDaemonCommand();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLU_PTY_HOST_SOCKET: opts.socketPath,
  };
  const out = openDaemonLog(opts.socketPath);
  const stdio: StdioOptions = ["ignore", out, out];

  const underSystemd = Boolean(process.env.INVOCATION_ID);
  const child = underSystemd
    ? spawn(
        "systemd-run",
        [
          "--user",
          "--collect", // GC each generation's unit object once it exits
          "--quiet",
          `--unit=${daemonUnitName(opts.socketPath)}`,
          // The unit runs in the user manager's clean env, NOT this server's, so
          // the daemon-needed dynamic vars must be forwarded explicitly.
          ...setenvArgs(env),
          "--",
          cmd,
          ...args,
        ],
        { env, detached: true, stdio },
      )
    : spawn(cmd, args, { env, detached: true, stdio });

  child.on("error", (err) => {
    opts.log.error({ err, cmd }, "failed to spawn the pty-host daemon");
  });
  // The child now owns its stdout/stderr (the inherited duplicate); drop the
  // parent's copy of the log fd so each spawn/restart doesn't leak one.
  closeSync(out);
  child.unref();
  opts.log.info(
    { cmd, underSystemd, socketPath: opts.socketPath },
    "spawned the pty-host daemon",
  );
}
