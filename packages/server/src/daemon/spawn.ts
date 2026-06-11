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
 */
import { spawn, type StdioOptions } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "kolu-shared";

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

/** Open a daemon log next to the socket (its dir is the 0700 runtime root), so
 *  a detached daemon's output is diagnosable instead of dropped on the floor. */
function openDaemonLog(socketPath: string): number {
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return openSync(join(dir, "pty-host-daemon.log"), "a", 0o600);
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
          "--collect", // GC the unit when it exits, so the name is reusable
          "--quiet",
          "--unit=kolu-pty-host",
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
  child.unref();
  opts.log.info(
    { cmd, underSystemd, socketPath: opts.socketPath },
    "spawned the pty-host daemon",
  );
}
