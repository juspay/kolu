/**
 * The survivable-spawn mechanism — the default `DaemonDriver`.
 *
 * A surface daemon must outlive the process that launches it, on whatever the
 * host platform is. That is **host-platform volatility, not program volatility**
 * (kaval vs `odu serve` spawn the same way; only the values differ), so the
 * mechanism lives here in the spine, parameterized over the four values the
 * program supplies — `{ binPath, args, env, unitPrefix }`. The incantation is
 * shared; the values are the caller's soul.
 *
 * Two platform branches, selected by the `INVOCATION_ID` gate:
 *
 *   - **Under a systemd user service** (`INVOCATION_ID` is set): a plain
 *     detached child does NOT survive on cgroup-v2 — `KillMode=control-group`
 *     walks cgroup membership, not the login session, so killing the parent
 *     service reaps the child too (the #1031 Linux failure). So we re-launch the
 *     daemon through `systemd-run --user`, which lands it in its OWN transient
 *     `.service` cgroup that outlives ours. **Per-spawn unique unit names**
 *     (`--unit`) because a dead unit can linger loaded and refuse a reused name;
 *     `--collect` to GC it; an **absolute binary path** because the transient
 *     unit's PATH is minimal; and `--setenv` for each forwarded var because a
 *     transient unit starts from systemd's environment, not ours — so the
 *     daemon-operational vars (`XDG_RUNTIME_DIR`, which decides the socket path)
 *     must be carried across explicitly.
 *
 *   - **Otherwise** (macOS, a bare login shell, a test): a detached, `unref`'d
 *     child already survives — macOS's launchd keeps it, and without a cgroup
 *     controller there is nothing to walk. The forwarded env is the child's env
 *     directly.
 *
 * The mechanism never decides WHAT to spawn or WHERE its socket lives — those
 * are `binPath`/`args`/`env`, the caller's values. It only knows how to make a
 * child outlive its parent on this host.
 */

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

export interface DaemonSpawnConfig {
  /** Absolute path to the daemon executable. Absolute because a systemd
   *  transient unit runs with a minimal PATH. */
  binPath: string;
  /** Arguments after `binPath` (e.g. `["--socket", path]`, or `[]` to let the
   *  daemon pick its own default socket). */
  args: string[];
  /** Vars the daemon needs that don't survive a transient-unit env reset —
   *  forwarded as `--setenv` under systemd, or set on the child's env
   *  otherwise. The caller's "soul" chooses the set (e.g. `XDG_RUNTIME_DIR`). */
  env: Record<string, string>;
  /** Transient `.service` unit-name prefix (a per-spawn unique suffix is
   *  appended). Only used on the systemd branch. */
  unitPrefix: string;
  /** The one fact only the caller knows: the daemon is being launched FROM
   *  SOURCE (dev/test), not from a built binary. `INVOCATION_ID` alone can't
   *  tell "I am a systemd service" from "my shell merely runs inside a systemd
   *  session", so a from-source caller reports it here — and the spine then
   *  forces detached even under a session, because `systemd-run`'s transient
   *  unit would strip the build environment the source launcher needs.
   *  Defaults to `false`. */
  fromSource?: boolean;
}

/** Spawn the daemon process so it outlives this one. Resolves once the child
 *  has actually spawned (its `spawn` event) — NOT once the daemon is serving
 *  (the endpoint waits for the socket separately); a surface daemon daemonizes
 *  itself. **Rejects** if the launch fails — ENOENT (bad `binPath`), EACCES, or
 *  a `systemd-run` that couldn't fork. Node emits that failure ASYNCHRONOUSLY on
 *  the child's `error` event; without a listener it would become an uncaught
 *  exception and take the supervising process down, so the driver owns that
 *  listener and surfaces the failure as a rejection the endpoint maps to `dead`. */
export interface DaemonDriver {
  spawn(): Promise<void>;
}

/** The slice of a spawned child the driver needs: `unref` (so the child outlives
 *  us) plus the `spawn`/`error` lifecycle events. The real `ChildProcess` is an
 *  `EventEmitter`, so `node:child_process`'s `spawn` satisfies this directly; a
 *  test seam may return just `{ unref }` (no emitter), in which case the driver
 *  resolves on the next tick — there is no real fork to fail. */
export type SpawnedChild = Pick<ChildProcess, "unref"> &
  Partial<Pick<ChildProcess, "once">>;

/** Injectable seams so the platform branch and the launched argv are
 *  unit-testable without actually forking `systemd-run`. */
export interface SpawnDriverDeps {
  /** Defaults to `process.env`. The `INVOCATION_ID` gate reads from here. */
  env?: Record<string, string | undefined>;
  /** Defaults to `node:child_process` `spawn`. */
  spawnProcess?: (
    command: string,
    args: string[],
    options: {
      detached: boolean;
      stdio: "ignore";
      env?: Record<string, string>;
    },
  ) => SpawnedChild;
  /** Per-spawn unique unit-name suffix. Default `${pid}-${now}-${counter}`;
   *  injectable so a test can pin the unit name. */
  unitSuffix?: () => string;
}

let spawnCounter = 0;

export function survivableSpawnDriver(
  cfg: DaemonSpawnConfig,
  deps: SpawnDriverDeps = {},
): DaemonDriver {
  const env = deps.env ?? process.env;
  const spawnProcess = deps.spawnProcess ?? nodeSpawn;
  const unitSuffix =
    deps.unitSuffix ??
    (() => {
      spawnCounter += 1;
      return `${process.pid}-${Date.now()}-${spawnCounter}`;
    });

  /** Wire a freshly-spawned child into the spawn promise: resolve on its `spawn`
   *  event (the launch succeeded), reject on `error` (ENOENT/EACCES/fork failure)
   *  — and ALWAYS attach the `error` listener so the async failure is handled
   *  rather than thrown as an uncaught exception that kills the parent. `unref`
   *  the child either way so it outlives us. A seam child with no `once` (the
   *  test mock) has no real fork to fail, so resolve on the next tick. */
  const settle = (child: SpawnedChild): Promise<void> => {
    child.unref();
    if (typeof child.once !== "function") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      child.once?.("spawn", () => resolve());
      child.once?.("error", (err) => reject(err));
    });
  };

  return {
    spawn(): Promise<void> {
      const underSystemd =
        !cfg.fromSource &&
        env.INVOCATION_ID !== undefined &&
        env.INVOCATION_ID !== "";

      if (underSystemd) {
        // systemd-run --user --collect --unit <prefix>-<uniq> \
        //   --setenv K=V ... <binPath> <args...>
        const setenv = Object.entries(cfg.env).flatMap(([k, v]) => [
          "--setenv",
          `${k}=${v}`,
        ]);
        const args = [
          "--user",
          "--collect",
          "--unit",
          `${cfg.unitPrefix}-${unitSuffix()}`,
          ...setenv,
          cfg.binPath,
          ...cfg.args,
        ];
        return settle(
          spawnProcess("systemd-run", args, {
            detached: true,
            stdio: "ignore",
          }),
        );
      }
      // Detached + unref: survives the parent on macOS/launchd and on a
      // cgroup-less host. The forwarded env is layered onto ours.
      return settle(
        spawnProcess(cfg.binPath, cfg.args, {
          detached: true,
          stdio: "ignore",
          env: { ...(env as Record<string, string>), ...cfg.env },
        }),
      );
    },
  };
}
