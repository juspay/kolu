/**
 * `currentBuildId()` — a stable identity for THIS kolu build, used to decide
 * whether a surviving PTY-host daemon is running *stale code* after a deploy.
 *
 * The #1031 production failure was a staleness check keyed on `pkgVersion`,
 * a build-invariant constant (`"0.1.0"`): `outdated` was *always false*, so
 * the "update pending" nudge never fired and a 20-hour-old daemon was reused
 * across every redeploy. The fix is to key on something that actually
 * changes per build.
 *
 * The kolu nix build stamps the real commit hash into a `kolu-stamped`
 * derivation (see `default.nix`), so the running entry script lives under a
 * `/nix/store/<hash>-kolu-stamped/...` path whose hash changes on every
 * deploy. `process.argv[1]` is that entry script (`packages/server/src/
 * index.ts` under the nix wrapper). We derive the build id from it:
 *
 *   - nix: the `/nix/store/<hash>-...` store name — changes per deploy, so a
 *     daemon spawned by an older server reports an older id → `outdated`.
 *   - dev (`just dev` / tsx from the worktree): the entry's directory —
 *     stable across restarts, so dev never sees spurious "update pending".
 *
 * Both kolu-server and the daemon compute this from their own `argv[1]`; the
 * daemon was spawned by whichever server was current at the time, so after a
 * deploy the surviving daemon's id is the old one and the fresh server's is
 * the new one — exactly the mismatch the nudge needs.
 */

import { dirname } from "node:path";

/** Pure derivation of a build id from an entry-script path. Exported for
 *  unit testing; `currentBuildId` applies it to `process.argv[1]`.
 *
 *   - `/nix/store/<hash>-kolu-stamped/...` → `<hash>-kolu-stamped` (changes
 *     per deploy, so a daemon spawned by an older server reports an older id).
 *   - any other path (dev / tsx from the worktree) → its directory (stable
 *     across restarts, so dev never sees spurious "update pending").
 *   - empty → `"unknown"`. */
export function deriveBuildId(entry: string | undefined): string {
  if (!entry) return "unknown";
  const store = /\/nix\/store\/([^/]+)/.exec(entry);
  return store ? (store[1] as string) : dirname(entry);
}

let cached: string | undefined;

/** The build identity of the currently-running kolu. Memoized — `argv[1]`
 *  does not change for a process's lifetime.
 *
 *  `KOLU_BUILD_ID_OVERRIDE` is a **test seam**: in dev/CI the server and the
 *  daemon share one entry path, so they always agree and `outdated` can never
 *  fire. Setting this env on a *restarted* server (with the surviving daemon
 *  spawned by the prior, un-overridden server) reproduces the real post-deploy
 *  mismatch — see `daemon-update.feature`. Production never sets it; the nix
 *  store hash is the real key. */
export function currentBuildId(): string {
  if (cached === undefined)
    cached =
      process.env.KOLU_BUILD_ID_OVERRIDE ?? deriveBuildId(process.argv[1]);
  return cached;
}
