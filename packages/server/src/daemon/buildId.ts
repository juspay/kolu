/**
 * `currentBuildId()` — a stable identity for the running **PTY-host source**,
 * used to decide whether a surviving PTY-host daemon is running *stale code*
 * after a deploy.
 *
 * The #1031 production failure was a staleness check keyed on `pkgVersion`,
 * a build-invariant constant (`"0.1.0"`): `outdated` was *always false*, so
 * the "update pending" nudge never fired and a 20-hour-old daemon was reused
 * across every redeploy. The first fix keyed on the whole-binary nix store
 * hash (`/nix/store/<hash>-kolu-stamped/...` via `argv[1]`), which over-fired
 * the opposite way: EVERY deploy — even ones that never touched `@kolu/pty-
 * host` — flipped `outdated` true and nudged the user to restart, and acting
 * on that nudge costs a terminal-losing daemon restart for zero benefit.
 *
 * Constraint #6 fix: key on a build-time hash of *just the pty-host source*,
 * baked by nix into `KOLU_PTY_HOST_BUILD_ID` (see `default.nix`). Both the
 * server and the daemon inherit that one constant from the environment (the
 * supervisor forwards env to the daemon), so they compute the SAME key —
 * `outdated` now flips ONLY when restarting actually picks up new terminal-
 * host code. Server- or client-only deploys no longer nudge.
 *
 * Precedence (highest → lowest), see `resolveBuildId`:
 *   1. `KOLU_BUILD_ID_OVERRIDE` — test seam (forces a mismatch in e2e).
 *   2. `KOLU_PTY_HOST_BUILD_ID` — the pty-host source hash baked by nix; the
 *      real production key.
 *   3. `deriveBuildId(argv[1])` — dev/tsx fallback, stable across restarts in
 *      a worktree so `just dev` never sees spurious "update pending".
 *
 * This is staleness keying only. Hard contract incompatibility (the daemon
 * speaks a wire protocol the server can't talk to) is a *separate*, forced-
 * restart path — see `PTY_HOST_CONTRACT_VERSION` in `ptyHostSurface.ts`.
 */

import { dirname } from "node:path";

/** Pure derivation of a build id from an entry-script path. The dev/tsx
 *  fallback (nix bakes `KOLU_PTY_HOST_BUILD_ID` instead). Exported for unit
 *  testing.
 *
 *   - `/nix/store/<hash>-kolu-stamped/...` → `<hash>-kolu-stamped`.
 *   - any other path (dev / tsx from the worktree) → its directory (stable
 *     across restarts, so dev never sees spurious "update pending").
 *   - empty → `"unknown"`. */
export function deriveBuildId(entry: string | undefined): string {
  if (!entry) return "unknown";
  const store = /\/nix\/store\/([^/]+)/.exec(entry);
  return store ? (store[1] as string) : dirname(entry);
}

/** Pure build-id resolver. Precedence (highest → lowest):
 *
 *   1. `override` (`KOLU_BUILD_ID_OVERRIDE`) — test seam.
 *   2. `ptyHostId` (`KOLU_PTY_HOST_BUILD_ID`) — pty-host source hash baked by
 *      nix; the production key.
 *   3. `deriveBuildId(entry)` — dev/tsx fallback from `argv[1]`. */
export function resolveBuildId(opts: {
  override?: string;
  ptyHostId?: string;
  entry: string | undefined;
}): string {
  return opts.override ?? opts.ptyHostId ?? deriveBuildId(opts.entry);
}

let cached: string | undefined;

/** The build identity of the running PTY-host source. Memoized — neither
 *  `argv[1]` nor the baked env changes for a process's lifetime.
 *
 *  See the file header for the precedence rationale. In production the nix
 *  wrapper bakes `KOLU_PTY_HOST_BUILD_ID` (the pty-host source hash) into both
 *  the server and — via the supervisor's env forwarding — the daemon, so they
 *  agree unless a deploy actually changed pty-host code. `KOLU_BUILD_ID_
 *  OVERRIDE` is the e2e test seam that forces a post-deploy mismatch (see
 *  `daemon-update.feature`); production never sets it. */
export function currentBuildId(): string {
  if (cached === undefined)
    cached = resolveBuildId({
      override: process.env.KOLU_BUILD_ID_OVERRIDE,
      ptyHostId: process.env.KOLU_PTY_HOST_BUILD_ID,
      entry: process.argv[1],
    });
  return cached;
}
