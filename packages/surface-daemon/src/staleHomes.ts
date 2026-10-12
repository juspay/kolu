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
 * And the law is applied to EVERY `*.pid` in the home, not just the app's own:
 * the removal is recursive and the home is co-tenanted (kolu-server's
 * "never two supervisors" claim lives in padi's home as `supervisor.pid`), so a
 * SIGKILLed padi beside a live supervisor must keep its directory. See
 * {@link everyGateDead}.
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
  // The sentinel sits at a KNOWN position — `resolveDaemonHome` builds the
  // instanced directory as `<app>-<instance>`, so the `0` is the character
  // right after `<app>-` — and it is spliced out by index rather than found by
  // `.replace("0", …)`. A search would take the FIRST zero in the string, which
  // is only the sentinel while neither the app stem nor the regime's `-$UID`
  // decoration contains one: `kaval-0-1000` survives that by luck, an app named
  // `relay0` would silently get `^relay[0-9a-f]+-0$` and match names the
  // builder never mints. A deleting loop does not get to be lucky.
  const sentinelAt = app.length + 1;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    root: dirname(bareDir),
    bareName: basename(bareDir),
    instancedRe: new RegExp(
      `^${esc(instancedName.slice(0, sentinelAt))}[0-9a-f]+${esc(
        instancedName.slice(sentinelAt + 1),
      )}$`,
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
 * Is EVERY pid gate in this home dead?
 *
 * A runtime home is CO-TENANTED, and the sweep removes it recursively, so the
 * app's own gate is not the whole question. kolu-server's "never two
 * supervisors" claim lives in padi's home as `supervisor.pid` beside padi's own
 * `padi.pid`, and pid-gate exclusion is `link(2)`/EEXIST on the FILE: a padi
 * that was SIGKILLed leaves a dead `padi.pid` while its supervising kolu-server
 * is perfectly alive, and removing the home on padi's gate alone would delete a
 * live claim — after which a second kolu-server claims successfully and the
 * surviving one is never told (juspay/kolu#2289 review, B4).
 *
 * So every `*.pid` in the home votes, and the verdict is a {@link StaleHomeSkip}
 * reason when it is not unanimous. `absent` cannot occur (the file was just
 * listed) and `malformed` is the pid gate's own "reap" verdict, so only a LIVE
 * holder or an UNREADABLE gate blocks removal — the same three-way law the
 * app's own gate is read under, applied to every tenant.
 */
function everyGateDead(dir: string): "all-dead" | "live" | "gate-unreadable" {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    // The home itself cannot be listed, so nothing in it can be judged dead.
    return "gate-unreadable";
  }
  for (const name of names) {
    if (!name.endsWith(".pid")) continue;
    const read = readGateIdentity(join(dir, name));
    if (read.kind === "unreadable") return "gate-unreadable";
    if (read.kind === "ok" && isHolderLive(read.pid)) return "live";
  }
  return "all-dead";
}

/**
 * Remove every runtime home of `app` under `runtimeRoots` whose gates ALL name
 * processes that are gone. Never throws.
 *
 * `gateFile` is the app's gate basename (`padi.pid`, `kaval.pid`) — passed
 * rather than derived, because kaval's bare stem and its home's decoration
 * differ and the gate name is the daemon's own constant. It decides whether a
 * home is a CANDIDATE (one carrying no gate of ours may be a daemon mid-boot,
 * and is left alone); {@link everyGateDead} then decides whether the candidate
 * is REMOVABLE, because the home is co-tenanted and the removal is recursive.
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
  const sweptGrammars = new Set<string>();

  for (const runtimeRoot of opts.runtimeRoots) {
    const { root, bareName, instancedRe } = homeGrammar(opts.app, runtimeRoot);
    // Keyed by root AND grammar, not root alone. The two arms can resolve to the
    // SAME directory with DIFFERENT name shapes — `XDG_RUNTIME_DIR=/tmp` gives
    // `/tmp/<app>-<hex>` for the env arm and `/tmp/<app>-<hex>-$UID` for the
    // forced one — and de-duping by root dropped the second, so on exactly such a
    // host the `-$UID` corpses this sweep exists for were never examined.
    const grammarKey = `${root}\u0000${bareName}\u0000${instancedRe.source}`;
    if (sweptGrammars.has(grammarKey)) continue;
    sweptGrammars.add(grammarKey);

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
      const own = readGateIdentity(join(dir, opts.gateFile));
      if (own.kind === "absent") {
        skipped.push({ dir, why: "no-gate" });
        continue;
      }
      // The home is removed RECURSIVELY, so the question is not "is my daemon
      // dead" but "is anything in here still held". Every `*.pid` gets a vote.
      const verdict = everyGateDead(dir);
      if (verdict !== "all-dead") {
        skipped.push({ dir, why: verdict });
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
