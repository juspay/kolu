/**
 * The **soul** of kolu's pty-host endpoint: the kaval-specific *values* the
 * survivable-spawn mechanism (the spine, `@kolu/surface-daemon-supervisor`)
 * takes as parameters. Everything host-platform-generic — the `INVOCATION_ID`
 * gate, `systemd-run --user`, the detached+unref fork, unique unit names — lives
 * in the spine's `survivableSpawnDriver`; this file only supplies what is
 * specific to *this* daemon: which binary, which args, which env, which unit
 * prefix, and where its socket + gate live.
 *
 * Binary resolution has two modes, the same closure either way:
 *   - **Production / nix** — `KOLU_KAVAL_BIN` points at the built `kaval`
 *     wrapper (`${kaval}/bin/kaval`, itself `node --import <tsx loader> bin.ts`).
 *     Spawn it directly with no leading args.
 *   - **Dev / e2e** — no wrapper exists, so reproduce its launcher shape from
 *     source: `node --import <tsx loader> packages/kaval/src/bin.ts`. The tsx
 *     loader is resolved through the package (not a hoisted `.bin` symlink),
 *     exactly as `socketDaemon.test.ts` does, so it works under `test-quick`.
 *
 * The dev-flag filter is by construction: kaval's argv is built fresh here, so
 * kolu's own `process.execArgv` (an `--inspect`, a heap-snapshot flag) never
 * propagates to the daemon; and `NODE_OPTIONS` is scrubbed of those same dev
 * flags before it reaches kaval — so kaval never opens the server's inspector or
 * writes the server's snapshots into the *server's* cwd. kaval IS the heap-OOM
 * site (kaval-heap-oom.mdx), so it is instrumented deliberately on its OWN
 * terms: `daemonEnv` forwards `KOLU_DIAG_DIR` and kaval's nix wrapper arms its
 * own heap-snapshot hooks under a kaval-private subdir.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DAEMON_BIND_PID_ENV } from "@kolu/surface-daemon";
import {
  type DaemonDriver,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import {
  assertDaemonSpawnAllowed,
  KAVAL_GATE_FILE,
  KOLU_ROLE_ENV,
  kavalLogPath,
} from "kaval";
import { composeSpawnEnv } from "kolu-pty";

/** The single-instance gate kaval claims, beside its socket — the same path
 *  kaval's own `daemonMain` derives (`<socket-dir>/kaval.pid`), so the
 *  supervisor reads the true current holder. Reuses kaval's own {@link
 *  KAVAL_GATE_FILE} literal so the daemon and the supervisor can't drift on it. */
export function kavalGatePath(socketPath: string): string {
  return join(dirname(socketPath), KAVAL_GATE_FILE);
}

/** Resolve how to launch kaval: the built wrapper in production, or the
 *  from-source `node --import <tsx loader> bin.ts` shape in dev/e2e.
 *
 *  The daemon is ALWAYS told to serve `socketPath` via `--socket` — the caller's
 *  resolved path (padi's digest-keyed `kaval-<digest>/pty-host.sock`, or a
 *  `KOLU_KAVAL_SOCKET` override) — so the spawned daemon lands on the exact socket
 *  padi dials, and never on kaval's bare default namespace. This is the
 *  per-instance isolation: each padi owns its own daemon at its own socket. */
export function resolveKavalLaunch(socketPath: string): {
  binPath: string;
  args: string[];
} {
  const socketArgs = ["--socket", socketPath];

  const wrapper = process.env.KOLU_KAVAL_BIN;
  if (wrapper) return { binPath: wrapper, args: socketArgs };

  // Dev/e2e: no nix wrapper — reproduce its launcher from source. The loader is
  // resolved via the package so the spawn doesn't depend on a hoisted .bin/tsx.
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const binTs = fileURLToPath(
    new URL("../../../kaval/src/bin.ts", import.meta.url),
  );
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, binTs, ...socketArgs],
  };
}

/** The env kaval is spawned with. Two layers:
 *
 *  1. A clean base composed from the shared `SPAWN_ENV_ALLOWLIST` (kolu-pty) —
 *     HOME/PATH/SHELL/… mined from the supervisor's own env. This is the 2a parity
 *     fix (#1872): the supervisor's detached spawn branch runs the daemon with
 *     `cfg.env` ALONE (no parent env layered — that would leak the supervisor's
 *     ambient identity vars into kaval and every PTY it spawns) unless
 *     `inheritParentEnv`, which we set ONLY for an actual from-source kaval
 *     (`!KOLU_KAVAL_BIN`) — so the built/production path gets `cfg.env` alone and
 *     `cfg.env` must itself be a COMPLETE env, matching what the systemd branch gets
 *     from PAM's manager env + `--setenv`. Composing from the allowlist (not
 *     forwarding process.env) is what keeps an orchestrator's `CLAUDE_CODE_*` out.
 *  2. The daemon-operational extras kaval needs on TOP of that base — the scrubbed
 *     `NODE_OPTIONS`, the run-bind pid, and `KOLU_DIAG_DIR`. `XDG_RUNTIME_DIR`
 *     (which decides the socket path) is NOT re-added here: it is a member of
 *     `SPAWN_ENV_OPERATIONAL`, so it already arrives via the allowlist base in (1)
 *     like every other operational var — exactly as padi's `daemonEnv` twin relies
 *     on it, keeping the two twins carrying it by the ONE mechanism. (KAVAL_BUILD_ID
 *     / KAVAL_COMMIT_HASH are set by kaval's own nix wrapper, so they don't need
 *     forwarding; PTY env arrives per-spawn on the wire since B0.)
 *
 *  Its exact key set is pinned in `localDriver.test.ts` so neither spawn branch's env
 *  can drift silently. */
export function daemonEnv(): Record<string, string> {
  const env: Record<string, string> = composeSpawnEnv(process.env);
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  // Forward the run-bind pid one hop further (server → padi → kaval): a harness/
  // smoke-spawned kaval binds its lifetime to the run and dies with it. UNSET in
  // production → kaval stays `forever`. Forward every DEFINED value (including an
  // empty one from a broken expansion) so it propagates to kaval and crashes there
  // via `daemonLifetimeFromEnv`'s fail-fast, never silently dropped back to `forever`.
  if (process.env[DAEMON_BIND_PID_ENV] !== undefined)
    env[DAEMON_BIND_PID_ENV] = process.env[DAEMON_BIND_PID_ENV];
  // Forward the isolation ROLE one hop further (server → padi → kaval, #1334): a
  // production padi hands `KOLU_ROLE=production` to the kaval it spawns so kaval
  // stamps the production role beside its OWN gate (`kaval-<digest>/role`) — without
  // this, production's kaval would self-stamp `dev` and the adopt/kill guard would
  // wrongly permit a dev process to SIGTERM it. Threaded EXPLICITLY (never via the
  // PTY allowlist) so it can't leak into a child shell. Absent → kaval defaults `dev`.
  if (process.env[KOLU_ROLE_ENV])
    env[KOLU_ROLE_ENV] = process.env[KOLU_ROLE_ENV];
  // Forward the diagnostics base dir so the SPAWNED kaval — the actual heap-OOM
  // site (kaval-heap-oom.mdx) — arms its OWN heap-snapshot hooks + periodic
  // heap/terms log under it. We scrub the server's `--heapsnapshot*` from
  // NODE_OPTIONS above (they'd point kaval's captures at the SERVER's cwd and
  // share its inspector); kaval's nix wrapper re-derives its own per-invocation
  // subdir from KOLU_DIAG_DIR instead, and kaval's diagnostics reads it directly.
  if (process.env.KOLU_DIAG_DIR) {
    env.KOLU_DIAG_DIR = process.env.KOLU_DIAG_DIR;
  }
  return env;
}

/** The kaval driver: the survivable-spawn mechanism bound to kaval's values.
 *
 *  Two facts the spine needs, DELIBERATELY separate (they used to be conflated):
 *    - `fromSource` — should we SKIP `systemd-run` and fork detached? True when there
 *      is no `KOLU_KAVAL_BIN` wrapper (dev/source) OR `KOLU_KAVAL_SPAWN=detached` forces
 *      it (e2e / a bare/pu box). This is the launch-path decision only.
 *    - `inheritParentEnv` — should the child layer our ambient env? True ONLY for an
 *      actual from-source kaval (`!KOLU_KAVAL_BIN`), which needs the dev nix-shell env.
 *      A BUILT kaval forced detached sets `fromSource` but NOT this — it carries its own
 *      wrapper env and must not inherit ours (#1872). */
export function localKavalDriver(socketPath: string): DaemonDriver {
  const { binPath, args } = resolveKavalLaunch(socketPath);
  const forceDetached =
    !process.env.KOLU_KAVAL_BIN || process.env.KOLU_KAVAL_SPAWN === "detached";
  const driver = survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(),
    unitPrefix: "kaval",
    // Force the detached branch for a from-source kaval OR a built one a box forces
    // detached; inherit the parent (nix-shell) env ONLY for an ACTUAL from-source kaval
    // (`!KOLU_KAVAL_BIN`) — a built forced-detached kaval carries its own wrapper env and
    // must not inherit ours (#1872). The union makes an env-inherit-on-normal-launch
    // unspellable.
    fromSource: forceDetached
      ? { inheritParentEnv: !process.env.KOLU_KAVAL_BIN }
      : false,
    // P0: kaval has no pino — its stderr (the surface-daemon stderrLogger) IS its log, so
    // capture it to the deterministic `kaval.log` beside its socket, bounded by
    // truncate-on-boot, so a kaval that outlives padi/kolu-server stays diagnosable.
    stderrLog: kavalLogPath(socketPath),
  });
  // The A8 runtime spawn leash at the REAL kaval funnel (F5): a gate-off vitest
  // worker can reach `localKavalDriver` through helper indirection, so the guard
  // sits at the driver's OWN spawn, not just in tests. A strict no-op in production
  // (no `VITEST`); the generic `survivableSpawnDriver` stays untouched (odu reuses it).
  return {
    spawn: () => {
      assertDaemonSpawnAllowed("a real kaval daemon");
      return driver.spawn();
    },
  };
}
