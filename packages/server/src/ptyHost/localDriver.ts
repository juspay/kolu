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

/** The socket kaval serves and the server dials — kaval's OWN default namespace
 *  (`$XDG_RUNTIME_DIR/kaval/pty-host.sock`), NOT a kolu-served one. That is the
 *  whole flip: the server no longer serves a socket; it spawns kaval, which
 *  serves this path, and `kaval-tui` (whose default is the same `kaval`
 *  namespace) reaches kolu's terminals with no `--socket` flag.
 *
 *  `KOLU_KAVAL_SOCKET` overrides the path entirely — the per-instance escape
 *  hatch. The boot policy is ALWAYS-RECYCLE: a server SIGTERMs whatever daemon
 *  holds its socket's gate before spawning fresh. So two kolu instances sharing
 *  the default namespace (a `just dev` beside a production `kolu.service`, a
 *  second worktree, a standalone kaval) would have the newcomer kill the
 *  incumbent's daemon and drop its terminals. An instance that must NOT own the
 *  default namespace points this at a private socket dir (the dev `server` recipe
 *  and the e2e per-worker `XDG_RUNTIME_DIR` both do exactly this), and the
 *  override is forwarded to the spawned kaval via `--socket` (`resolveKavalLaunch`)
 *  so the daemon serves the very path the server dials. */
export function kavalSocketPath(): string {
  return getPtyHostSocketPath(process.env.KOLU_KAVAL_SOCKET, "kaval");
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
 *  When `KOLU_KAVAL_SOCKET` is set, the daemon is told to serve THAT path via
 *  `--socket` so it lands on the exact socket the server dials (`kavalSocketPath`)
 *  — the per-instance isolation that keeps a `just dev` / second worktree from
 *  recycling another instance's daemon. Absent the override kaval picks its own
 *  default (`kaval` namespace), so no flag is passed and `kaval-tui` reaches it
 *  with no `--socket` either. */
export function resolveKavalLaunch(): { binPath: string; args: string[] } {
  const socketOverride = process.env.KOLU_KAVAL_SOCKET;
  const socketArgs = socketOverride ? ["--socket", socketOverride] : [];

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
export function localKavalDriver(): DaemonDriver {
  const { binPath, args } = resolveKavalLaunch();
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
