/**
 * The running kaval daemon's build identity — pure reads of the env nix bakes.
 *
 * `currentBuildId()` is the **staleKey**: a hash of kaval's source closure (the
 * package, plus the daemon-side roots `terminal-protocol` and `surface-daemon`),
 * baked into `KAVAL_BUILD_ID` by `default.nix` and `--set` on both the kolu
 * wrapper (kaval runs in-process there until B2) and kaval's own bin. It flips
 * iff a restart would load different daemon wire/behaviour code — phase B
 * compares it against the server's expected build to derive "update pending",
 * so server-/client-only deploys never nudge.
 *
 * `currentCommitHash()` is the **navigableCommit**: the git ref this kaval was
 * built from (`KAVAL_COMMIT_HASH`), surfaced to the ChromeBar as the
 * GitHub-clickable identity. kaval reads its OWN identity-env namespace
 * (`KAVAL_*`, not kolu's `KOLU_COMMIT_HASH`) so the package keeps zero coupling
 * to its host — the graduation rule.
 *
 * Nix is first-class: kaval runs only under nix, so there is no dev-derivation
 * fallback. Off-nix (raw `vitest`, or a `kaval` built without the env) the vars
 * are absent and both return `""` — the readout shows nothing rather than
 * inventing an identity. Staleness is never computed here; it is a read-site
 * derivation (`staleKey !== currentBuildId()`) that phase B adds.
 */

import type { PtyHostIdentity } from "./ptyHostSurface.ts";

/** The staleKey — the nix-baked hash of kaval's daemon source closure. */
export function currentBuildId(): string {
  return process.env.KAVAL_BUILD_ID ?? "";
}

/** The navigable git commit this kaval was built from. */
export function currentCommitHash(): string {
  return process.env.KAVAL_COMMIT_HASH ?? "";
}

/** kaval's full identity — `{ staleKey, navigableCommit }` — assembled at the
 *  source that owns the reads, so the field mapping lives in one place. Phase
 *  B's separate daemon reuses this instead of re-deriving the shape. */
export function currentPtyHostIdentity(): PtyHostIdentity {
  return { staleKey: currentBuildId(), navigableCommit: currentCommitHash() };
}
