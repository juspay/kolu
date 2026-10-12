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
 * fail because a corpse was stubborn. So is a regime root that cannot be listed
 * at all.
 *
 * ## It reads its roots from a parameter
 *
 * {@link reapStaleDaemonHomes} consults nothing ambient — the regimes to sweep
 * are an argument, and {@link daemonSweepRegimes} is the policy a daemon passes.
 * That split is not tidiness: a sweep that read the environment itself could
 * only be tested by letting it loose on the developer's real `/tmp`, which on a
 * host of the kind #2286 describes both destroys unrelated state and makes every
 * assertion depend on what the box happened to be carrying.
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

/** Why a candidate home was left in place — or, for `root-unreadable`, why a
 *  whole regime contributed nothing. */
export interface StaleHomeSkip {
  /** The home, except for `root-unreadable`, where it is the REGIME ROOT. */
  readonly dir: string;
  readonly why:
    | "not-ours"
    | "live"
    | "no-gate"
    | "gate-unreadable"
    | "remove-failed"
    | "root-unreadable";
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

/** The regimes a DAEMON sweeps at boot: the one in force, and the `/tmp`
 *  fallback — `/tmp` always, because it is the regime nothing wipes and therefore
 *  the one that accumulates. De-duped by resolved root inside the sweep, so a
 *  process already running under `/tmp` sweeps it once.
 *
 *  Separate from {@link reapStaleDaemonHomes} so the sweep itself reads its roots
 *  from a PARAMETER and touches nothing else. A sweep that consulted the ambient
 *  environment could not be tested without deleting from the developer's real
 *  `/tmp` — on the very host class #2286 describes (5.4 K corpses) that would both
 *  destroy unrelated state and make the assertions depend on what the box happened
 *  to be carrying. */
export function daemonSweepRegimes(): readonly (
  | DaemonHomeRuntimeRoot
  | undefined
)[] {
  return runtimeRegimeInForce() === "xdg" ? [undefined, null] : [null];
}

/**
 * Remove every runtime home of `app` under `runtimeRoots` whose gate file names
 * a process that is gone. Never throws.
 *
 * `gateFile` is the app's gate basename (`padi.pid`, `kaval.pid`) — passed
 * rather than derived, because kaval's bare stem and its home's decoration
 * differ and the gate name is the daemon's own constant.
 *
 * `runtimeRoots` is the regime list to sweep, in {@link DaemonHomeRuntimeRoot}'s
 * vocabulary (`undefined` = the live env's drawer, `null` = the forced `/tmp`
 * fallback, a string = that drawer as XDG). A daemon passes
 * {@link daemonSweepRegimes}; a test passes its own scratch drawer and can
 * therefore assert an exact `removed` set.
 */
export function reapStaleDaemonHomes(opts: {
  app: string;
  gateFile: string;
  runtimeRoots: readonly (DaemonHomeRuntimeRoot | undefined)[];
}): StaleHomeSweep {
  const removed: string[] = [];
  const skipped: StaleHomeSkip[] = [];
  const seenRoots = new Set<string>();

  for (const runtimeRoot of opts.runtimeRoots) {
    const { root, bareName, instancedRe } = homeGrammar(opts.app, runtimeRoot);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);

    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch (err) {
      // An unreadable root contributes nothing — the same refusal discovery
      // makes, and not a boot failure. REPORTED rather than swallowed: a root
      // this process cannot read is the one condition under which a sweep
      // silently collects nothing, and an operator chasing a pile of corpses
      // needs to see that said so.
      skipped.push({ dir: root, why: "root-unreadable", err });
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
