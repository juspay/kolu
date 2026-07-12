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
import {
  type DaemonDriver,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { KAVAL_GATE_FILE, kavalLogPath } from "kaval";

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

/** The daemon-operational env kaval needs that doesn't survive a transient
 *  systemd unit's env reset — chiefly `XDG_RUNTIME_DIR`, which decides the
 *  socket path. (KAVAL_BUILD_ID / KAVAL_COMMIT_HASH are set by kaval's own nix
 *  wrapper, so they don't need forwarding in production; PTY env arrives
 *  per-spawn on the wire since B0, so it isn't here either.) */
function daemonEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.XDG_RUNTIME_DIR) {
    env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
  }
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  // Forward the run-bind pid one hop further (server → padi → kaval): a harness/
  // smoke-spawned kaval binds its lifetime to the run and dies with it. Absent in
  // production → kaval stays `forever`.
  if (process.env.KOLU_DAEMON_BIND_PID)
    env.KOLU_DAEMON_BIND_PID = process.env.KOLU_DAEMON_BIND_PID;
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
 *  The only survival-relevant fact kolu uniquely knows is whether kaval is being
 *  launched from source: no `KOLU_KAVAL_BIN` wrapper means dev/source, and
 *  `KOLU_KAVAL_SPAWN=detached` lets e2e force the same. That single boolean is
 *  all the spine needs — it owns the launch-path decision. */
export function localKavalDriver(socketPath: string): DaemonDriver {
  const { binPath, args } = resolveKavalLaunch(socketPath);
  const fromSource =
    !process.env.KOLU_KAVAL_BIN || process.env.KOLU_KAVAL_SPAWN === "detached";
  return survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(),
    unitPrefix: "kaval",
    fromSource,
    // P0: kaval has no pino — its stderr (the surface-daemon stderrLogger) IS its log, so
    // capture it to the deterministic `kaval.log` beside its socket, bounded by
    // truncate-on-boot, so a kaval that outlives padi/kolu-server stays diagnosable.
    stderrLog: kavalLogPath(socketPath),
  });
}
