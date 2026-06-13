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
 * flags before it reaches kaval, so a kolu launched with diagnostics doesn't
 * make kaval write heap snapshots too.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPtyHostSocketPath } from "kaval";
import {
  type DaemonDriver,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";

/** The socket kaval serves and the server dials, namespaced **per kolu-server
 *  instance by its listen port** — `$XDG_RUNTIME_DIR/kaval-<port>/pty-host.sock`.
 *  The server no longer serves a socket; it spawns kaval, tells it (via
 *  `--socket`) to serve exactly this path, and dials it.
 *
 *  Why per-port, not a single shared `kaval` namespace: the boot policy is
 *  ALWAYS-RECYCLE — a starting server SIGTERMs whatever daemon holds its socket's
 *  gate before spawning fresh. A *shared* namespace makes that recycle reach
 *  ACROSS instances: a second kolu-server (a `just dev`, a second worktree, a
 *  bug-repro `kolu` on another port beside a production `kolu.service`) would find
 *  the production daemon at the shared gate, kill it, and drop every one of its
 *  terminals — exactly the prod incident this keying fixes. Two servers can't
 *  share a listen port, so keying the namespace by port makes each instance own a
 *  private daemon by construction; the recycle can only ever reach this instance's
 *  own daemon.
 *
 *  `KOLU_KAVAL_SOCKET` still overrides the whole path (an explicit escape hatch
 *  for a fully pinned rendezvous — the e2e harness uses it); when set it wins over
 *  the per-port default. */
export function kavalSocketPath(port: number): string {
  return getPtyHostSocketPath(process.env.KOLU_KAVAL_SOCKET, `kaval-${port}`);
}

/** The single-instance gate kaval claims, beside its socket — the same path
 *  kaval's own `daemonMain` derives (`<socket-dir>/kaval.pid`), so the
 *  supervisor reads the true current holder. */
export function kavalGatePath(socketPath: string): string {
  return join(dirname(socketPath), "kaval.pid");
}

/** Resolve how to launch kaval: the built wrapper in production, or the
 *  from-source `node --import <tsx loader> bin.ts` shape in dev/e2e.
 *
 *  The daemon is ALWAYS told to serve `socketPath` via `--socket` — the server's
 *  per-port (or `KOLU_KAVAL_SOCKET`-overridden) path — so the spawned daemon lands
 *  on the exact socket the server dials, and never on kaval's bare default
 *  namespace. This is the per-instance isolation: each server owns its own daemon
 *  at its own socket. */
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

/** Strip dev-only flags from a `NODE_OPTIONS` string so a kolu started with
 *  diagnostics doesn't make the spawned kaval inherit them (and start writing
 *  its own heap snapshots / open an inspector). Returns undefined if nothing of
 *  value remains, so the var is dropped rather than set to empty. */
function scrubNodeOptions(raw: string | undefined): string | undefined {
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
  const nodeOptions = scrubNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
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
  });
}
