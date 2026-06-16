/**
 * The running kolu-watcher's build identity — pure reads of the env nix bakes.
 *
 * `currentWatcherBuildId()` is the **staleKey**: a hash of kolu-watcher's source
 * closure (the package plus the kolu app code its DAG/fs-git legitimately reach),
 * baked into `KOLU_WATCHER_BUILD_ID` by `default.nix`. It flips iff a restart
 * would load different watcher code — kolu-server compares it against the build
 * it would provision to derive an "update pending" nudge for a wire-compatible
 * but stale remote watcher.
 *
 * `currentWatcherCommitHash()` is the **navigableCommit**: the git ref this
 * watcher was built from (`KOLU_WATCHER_COMMIT_HASH`).
 *
 * Like kaval, the watcher reads its OWN identity-env namespace. Off-nix (raw
 * `vitest`) the vars are absent and both return `""` — no invented identity.
 */

import type { PtyHostIdentity } from "kaval";

/** The staleKey — the nix-baked hash of kolu-watcher's source closure. */
export function currentWatcherBuildId(): string {
  return process.env.KOLU_WATCHER_BUILD_ID ?? "";
}

/** The navigable git commit this kolu-watcher was built from. */
export function currentWatcherCommitHash(): string {
  return process.env.KOLU_WATCHER_COMMIT_HASH ?? "";
}

/** kolu-watcher's full identity — reusing kaval's `{ staleKey, navigableCommit }`
 *  shape so kolu-server reads a remote watcher's identity the same way it reads
 *  a kaval's. */
export function currentWatcherIdentity(): PtyHostIdentity {
  return {
    staleKey: currentWatcherBuildId(),
    navigableCommit: currentWatcherCommitHash(),
  };
}
