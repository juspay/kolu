/**
 * The corpse collector for daemon runtime homes.
 *
 * A daemon's runtime home (`$XDG_RUNTIME_DIR/<app>[-<instance>]/`, or
 * `/tmp/<app>[-<instance>]-$UID/` off XDG) holds its gate, its socket and its
 * manifests. `$XDG_RUNTIME_DIR` is wiped by logind at logout, so the XDG regime
 * collects nothing — but **nothing wipes `/tmp`**. Every daemon that ever
 * crashed, or ran under a test harness with XDG unset, leaves its home behind
 * forever. On the host that reported juspay/kolu#2286 that was **5.4 K dead
 * `kaval-*` / `padi-*` directories** inside a `/tmp` of 209 K entries, and the
 * cost showed up as a `readdirSync` that discovery paid every ten seconds.
 *
 * So the regime nobody cleans gets swept, once, at the boot of the daemon that
 * owns these names. This is NOT a reaper of live daemons: it dials nothing,
 * kills nothing, and signals nothing. It removes a directory only when the
 * directory's own gate file PROVES its owner is gone.
 *
 * ## What it refuses to touch, and why
 *
 * The removal predicate is the pid gate's existing three-way law
 * ({@link readGateIdentity}), not a new one:
 *
 *  - **`ok` + live holder** — a running daemon. Kept.
 *  - **`ok` + dead holder** — a corpse. Removed.
 *  - **`malformed`** — honest garbage (the law already says "reap"). Removed.
 *  - **`absent`** — no gate at all. KEPT, because "no gate yet" is also what a
 *    daemon looks like in the window between creating its home and claiming its
 *    gate. A sweep cannot tell that from a corpse, so it declines to guess.
 *  - **`unreadable`** — EACCES/EIO is not an observation (the law again). Kept.
 *
 * And before any of that, the home must pass {@link isPrivateOwnedDir}: the same
 * owner-only boundary the serving side enforces, so a name another local user
 * planted under the shared `/tmp` root is never removed by us.
 *
 * A directory that refuses to be removed is reported, not thrown: boot must not
 * fail because a corpse was stubborn.
 */

import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type DaemonHomeRuntimeRoot,
  resolveDaemonHome,
  runtimeRegimeInForce,
} from "./daemonHome.ts";
import { isHolderLive, readGateIdentity } from "./pidGate.ts";
import { isPrivateOwnedDir } from "./privateOwnedDir.ts";

/** Why a candidate home was left in place. */
export interface StaleHomeSkip {
  readonly dir: string;
  readonly why:
    | "not-ours"
    | "live"
    | "no-gate"
    | "gate-unreadable"
    | "remove-failed";
  readonly err?: unknown;
}

/** What one sweep did. `removed` is the fact worth logging; `skipped` is the
 *  diagnostic for a home that survived a sweep it looked eligible for. */
export interface StaleHomeSweep {
  readonly removed: readonly string[];
  readonly skipped: readonly StaleHomeSkip[];
}

/** The name grammar of one app under one regime: its bare home's name, and the
 *  pattern its instanced homes take. Both are READ BACK from the same
 *  `resolveDaemonHome` builder a live daemon constructs with — a sweep that
 *  spelled the shape itself could delete a directory the builder would never
 *  mint, which is the one mistake a deleting loop may not make. */
function homeGrammar(
  app: string,
  runtimeRoot: DaemonHomeRuntimeRoot | undefined,
): { root: string; bareName: string; instancedRe: RegExp } {
  const bareDir = resolveDaemonHome({
    app,
    placement: "runtime",
    runtimeRoot,
  }).dir;
  const instancedName = basename(
    resolveDaemonHome({ app, placement: "runtime", instance: "0", runtimeRoot })
      .dir,
  );
  return {
    root: dirname(bareDir),
    bareName: basename(bareDir),
    // The sentinel instance `0` becomes a hex capture; everything else is
    // escaped so a `/tmp` path cannot inject regex metacharacters.
    instancedRe: new RegExp(
      `^${instancedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("0", "[0-9a-f]+")}$`,
    ),
  };
}

/**
 * Remove every runtime home of `app` whose gate file names a process that is
 * gone. Sweeps the regime in force and the `/tmp` fallback; never throws.
 *
 * `gateFile` is the app's gate basename (`padi.pid`, `kaval.pid`) — passed
 * rather than derived, because kaval's bare stem and its home's decoration
 * differ and the gate name is the daemon's own constant.
 */
export function reapStaleDaemonHomes(opts: {
  app: string;
  gateFile: string;
}): StaleHomeSweep {
  const removed: string[] = [];
  const skipped: StaleHomeSkip[] = [];
  const seenRoots = new Set<string>();

  // The regime in force AND the `/tmp` fallback, because `/tmp` is the regime
  // that accumulates. De-duped by resolved root below, so a process already
  // running under `/tmp` sweeps it once.
  const regimes: readonly (DaemonHomeRuntimeRoot | undefined)[] =
    runtimeRegimeInForce() === "xdg" ? [undefined, null] : [null];
  for (const runtimeRoot of regimes) {
    const { root, bareName, instancedRe } = homeGrammar(opts.app, runtimeRoot);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);

    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      // An unreadable root contributes nothing — the same refusal discovery
      // makes. Not a boot failure.
      continue;
    }

    for (const name of entries) {
      if (name !== bareName && !instancedRe.test(name)) continue;
      const dir = join(root, name);
      if (!isPrivateOwnedDir(dir)) {
        skipped.push({ dir, why: "not-ours" });
        continue;
      }
      const read = readGateIdentity(join(dir, opts.gateFile));
      if (read.kind === "absent") {
        skipped.push({ dir, why: "no-gate" });
        continue;
      }
      if (read.kind === "unreadable") {
        skipped.push({ dir, why: "gate-unreadable" });
        continue;
      }
      if (read.kind === "ok" && isHolderLive(read.pid)) {
        skipped.push({ dir, why: "live" });
        continue;
      }
      try {
        rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
      } catch (err) {
        skipped.push({ dir, why: "remove-failed", err });
      }
    }
  }

  return { removed, skipped };
}
