/**
 * The **soul** of kolu's local-`pulam` endpoint — the pulam-specific *values* the
 * supervisor spine (`@kolu/surface-daemon-supervisor`) takes as parameters, the
 * exact twin of `localDriver.ts` for kaval, with ONE deliberate difference: the
 * driver is {@link ephemeralSpawnDriver}, not the survivable one.
 *
 * pulam's awareness is *re-derivable* (recomputed from the surviving kaval on
 * every boot), so — unlike kaval, which owns the PTYs and must SURVIVE a kolu
 * restart — the local pulam should **die with kolu** and a fresh one re-derive on
 * boot. So it is spawned as a plain child (reaped with kolu's cgroup under
 * systemd; a child elsewhere), holds **no pid-gate**, and the supervisor's
 * `adoptOrEnsure` therefore always *ensures* (spawns fresh), never adopts — the
 * R9.0 lifecycle decision. The driver self-recycles its own prior child, so a
 * re-`ensure()` after a dropped link can't leave two pulams racing the socket.
 *
 * Binary resolution is the same two-mode closure as kaval:
 *   - **Production / nix** — `KOLU_PULAM_BIN` points at the built `pulam` wrapper
 *     (`${pulam}/bin/pulam`, itself `node --import <tsx loader> bin.ts`, which
 *     self-carries git + the pinned `gh`). Spawn it directly.
 *   - **Dev / e2e** — no wrapper, so reproduce its launcher from source:
 *     `node --import <tsx loader> packages/pulam/src/bin.ts`. The tsx loader is
 *     resolved through the package (not a hoisted `.bin`), so it works under
 *     `test-quick`.
 *
 * pulam is ALWAYS told both endpoints on the command line: `--kaval <socket>`
 * (the kaval this kolu-server supervises — pulam dials it to read the taps) and
 * `--socket <socket>` (where pulam serves its awareness for kolu to mirror).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeSocketPath } from "@kolu/surface/unix-socket";
import {
  type DaemonDriver,
  ephemeralSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { resolveDaemonLaunch } from "./daemonLaunch.ts";

/** The socket the local pulam serves and kolu-server mirrors, namespaced **per
 *  kolu-server instance by its listen port** (`$XDG_RUNTIME_DIR/pulam-<port>/
 *  awareness.sock`) — the same per-instance isolation kaval's socket has, so a
 *  second kolu-server (a `just dev`, a second worktree) never collides with this
 *  one's pulam. */
export function pulamLocalSocketPath(port: number): string {
  return getRuntimeSocketPath({
    app: `pulam-${port}`,
    file: "awareness.sock",
  });
}

/** Where pulam's single-instance gate WOULD live, beside its socket. The
 *  supervisor's `EndpointSpec` requires a `gatePath`, but the EPHEMERAL local
 *  pulam writes NO gate (it owns nothing irreplaceable) — so this file never
 *  exists, the supervisor reads "no holder", and `adoptOrEnsure` goes straight to
 *  a fresh spawn. The ephemeral driver owns the recycle off its child handle, not
 *  this path. (A nominal value to satisfy the spec; intentionally never created.) */
export function pulamGatePath(socketPath: string): string {
  return join(dirname(socketPath), "pulam.pid");
}

/** Resolve how to launch the local pulam: the built wrapper in production, or the
 *  from-source `node --import <tsx loader> bin.ts` shape in dev/e2e. pulam is
 *  always told its kaval (`--kaval`) and its serve socket (`--socket`). */
export function resolvePulamLaunch(
  pulamSocket: string,
  kavalSocket: string,
): { binPath: string; args: string[] } {
  return resolveDaemonLaunch({
    binEnvVar: "KOLU_PULAM_BIN",
    sourceBinPath: fileURLToPath(
      new URL("../../../pulam/src/bin.ts", import.meta.url),
    ),
    daemonArgs: ["--kaval", kavalSocket, "--socket", pulamSocket],
  });
}

/** The daemon-operational env the local pulam needs. `XDG_RUNTIME_DIR` decides
 *  its socket paths; `KOLU_GH_BIN` is the pinned `gh` the PR sensor shells out to
 *  — forwarded so a FROM-SOURCE pulam (dev/e2e) resolves it (the production
 *  wrapper bakes its own). The ephemeral child inherits the rest of kolu's env
 *  (git on PATH, the devshell), so unlike kaval's systemd-run we forward only
 *  what a transient reset would otherwise drop. */
function daemonEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.XDG_RUNTIME_DIR) {
    env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
  }
  if (process.env.KOLU_GH_BIN) {
    env.KOLU_GH_BIN = process.env.KOLU_GH_BIN;
  }
  return env;
}

/** The local-pulam driver: the ephemeral-spawn mechanism bound to pulam's values
 *  (its binary, its `--kaval`/`--socket` args, its env). */
export function localPulamDriver(
  pulamSocket: string,
  kavalSocket: string,
): DaemonDriver {
  const { binPath, args } = resolvePulamLaunch(pulamSocket, kavalSocket);
  return ephemeralSpawnDriver({
    binPath,
    args,
    env: daemonEnv(),
    unitPrefix: "pulam",
  });
}
