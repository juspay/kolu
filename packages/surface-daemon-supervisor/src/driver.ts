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
import { closeSync, mkdirSync, openSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export interface DaemonSpawnConfig {
  /** Absolute path to the daemon executable. Absolute because a systemd
   *  transient unit runs with a minimal PATH. */
  binPath: string;
  /** Arguments after `binPath` (e.g. `["--socket", path]`, or `[]` to let the
   *  daemon pick its own default socket). */
  args: string[];
  /** The env the daemon runs under — but its meaning depends on the launch mode
   *  the driver selects, so the caller must compose it for the mode it will hit:
   *   - **detached** (non-`fromSource`, the production path): `env` is the
   *     COMPLETE child env. NO parent env is layered underneath — that would leak
   *     the supervisor's ambient identity vars into the daemon and every PTY it
   *     spawns (the #1872 class) — so `env` must already carry HOME/PATH/SHELL/…
   *     itself. Compose it from the shared spawn-env allowlist (see padi's
   *     `daemonEnv`); a PARTIAL env here spawns a daemon with no PATH/HOME.
   *   - **systemd** (`systemd-run --user`): `env` OVERLAYS the unit's PAM/manager
   *     env via `--setenv` (each key WINS over the value it shadows). Here a
   *     partial set is fine — it names only the vars that don't survive the
   *     transient-unit env reset (e.g. `XDG_RUNTIME_DIR`).
   *   - **fromSource** (dev: `just dev` from a nix-shell): `env` is LAYERED OVER
   *     the supervisor's full parent env, the one path that opts into inheriting
   *     the developer's ambient shell (nix store paths, dev vars) to run from
   *     source. */
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
  /** A crash-catcher file for the daemon's raw STDERR, wired ONLY when this spawn is DETACHING
   *  — detaching means nobody holds the child's stderr, so a file is mandatory (P0):
   *  truncate-on-boot (one `.old` generation) keeps it bounded. An ATTACHED (systemd) spawn
   *  keeps parent-owned stderr (journald) and IGNORES this. The caller derives the path
   *  deterministically from the daemon's identity. */
  stderrLog?: string;
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
      stdio: "ignore" | Array<"ignore" | number>;
      env?: Record<string, string>;
    },
  ) => SpawnedChild;
  /** Per-spawn unique unit-name suffix. Default `${pid}-${now}-${counter}`;
   *  injectable so a test can pin the unit name. */
  unitSuffix?: () => string;
}

/** Strip dev-only Node flags from a `NODE_OPTIONS` string before a spawned daemon
 *  inherits it, so the daemon never opens the SUPERVISOR's inspector or writes the
 *  supervisor's heap/cpu profiles into the supervisor's cwd. This is domain-agnostic
 *  spawn-mechanism policy — it names Node profiler flags, nothing program-specific —
 *  so it lives here beside `survivableSpawnDriver` (the one place that forks the
 *  child), and every driver's env-builder composes it instead of re-declaring the
 *  filter. Returns `undefined` when nothing of value remains, so the var is DROPPED
 *  rather than set to empty. Purely additive: `survivableSpawnDriver`'s own
 *  env-layering is untouched, so a spine consumer that does NOT scrub (e.g. odu) is
 *  unaffected — the scrub is opt-in per driver, not baked into every spawn. */
export function scrubDaemonNodeOptions(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const kept = raw
    .split(/\s+/)
    .filter(
      (f) =>
        f !== "" &&
        !f.startsWith("--inspect") &&
        !f.startsWith("--heapsnapshot") &&
        !f.startsWith("--heap-prof") &&
        !f.startsWith("--cpu-prof"),
    );
  return kept.length > 0 ? kept.join(" ") : undefined;
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
        // ATTACHED to journald: the transient unit's parent (systemd) holds the daemon's
        // stderr, so NO crash-catcher file here — `journalctl --user -u <unit>` reads it
        // (P0: the crash-catcher file is wired only when DETACHING, where nobody holds it).
        // The daemon's own pino stream still lands in its rolled file via its entrypoint.
        // systemd-run --user --collect --unit <prefix>-<uniq> --setenv K=V ... <bin> <args>
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
      // DETACHED + unref: survives the parent on macOS/launchd and on a cgroup-less host, and
      // nobody holds the child's stderr — so wire the crash-catcher file (P0), truncate-on-boot
      // (keep ONE `.old` generation) so it stays bounded. The forwarded env is layered on ours.
      let stderrFd: "ignore" | number = "ignore";
      if (cfg.stderrLog) {
        // `mode: 0o700` is LOAD-BEARING: the crash-catcher dir can be the daemon's OWN runtime
        // home (kaval's `kaval-<digest>/`), and kaval REFUSES to serve on a non-private dir
        // (#1313 owner-only). Creating it 0755 (the umask-022 default of a bare `mkdir`) makes
        // kaval refuse → padi's ensureLocalEndpoint times out → the whole remote bind flaps.
        mkdirSync(dirname(cfg.stderrLog), { recursive: true, mode: 0o700 });
        // Rotate the prior capture WITHOUT a check-then-use race: attempt the rename and
        // swallow only ENOENT (no prior boot), never existsSync-then-rename (a TOCTOU).
        try {
          renameSync(cfg.stderrLog, `${cfg.stderrLog}.old`);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        // Mode 0o600: the crash-catcher can hold sensitive stderr — owner-only, never the
        // world-readable 0644 a bare openSync would create under umask 022.
        stderrFd = openSync(cfg.stderrLog, "a", 0o600);
      }
      const child = spawnProcess(cfg.binPath, cfg.args, {
        detached: true,
        stdio:
          typeof stderrFd === "number"
            ? ["ignore", "ignore", stderrFd]
            : "ignore",
        // ENV PARITY with the systemd branch, and the #1872 invariant. systemd-run
        // (above) runs the daemon under systemd's own manager env with `--setenv`
        // OVERLAYING cfg.env on top (--setenv WINS over any PAM/manager value it
        // shadows). This detached branch must reach the SAME child env — so it is
        // `cfg.env` alone, NOT `{ ...parentEnv, ...cfg.env }`. Layering the
        // supervisor's full parent env underneath is exactly the ambient-leak the
        // structural fix closes: the supervisor's own env can carry an orchestrator's
        // identity vars (CLAUDE_CODE_CHILD_SESSION, #1872) or other ambient markers,
        // and they would ride into the daemon and every PTY it spawns. cfg.env is
        // caller-composed COMPLETE (its base is the shared spawn-env allowlist — see
        // padi's `daemonEnv`), so the child needs nothing layered under it.
        //   The ONE exception is `fromSource` (dev: `just dev` from a nix-shell),
        // where the daemon genuinely needs the developer's ambient shell env (nix
        // store paths, dev vars) to run from source — a deliberate dev-only path, the
        // single caller that opts into parent layering.
        env: cfg.fromSource
          ? { ...(env as Record<string, string>), ...cfg.env }
          : cfg.env,
      });
      // The child inherited the fd; drop the parent's copy so we don't leak it.
      if (typeof stderrFd === "number") closeSync(stderrFd);
      return settle(child);
    },
  };
}
