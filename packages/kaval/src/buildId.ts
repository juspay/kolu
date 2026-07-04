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
 *
 * The env-read RECIPE (which `<PREFIX>_*` vars, the `{ staleKey, navigableCommit }`
 * shape, the off-nix `""` floor) is shared with padi via `readBakedIdentity` in
 * `@kolu/surface-daemon` — these are the thin, kaval-prefixed façade over it, so the
 * public `currentBuildId` / `currentCommitHash` / `currentPtyHostIdentity` names its
 * callers use are unchanged.
 */

import { readBakedIdentity } from "@kolu/surface-daemon";
import type { PtyHostIdentity } from "./ptyHostSurface.ts";

/** kaval's full identity — `{ staleKey, navigableCommit }` — read from the `KAVAL_*`
 *  env namespace via the shared recipe. Phase B's separate daemon reuses this instead
 *  of re-deriving the shape. */
export function currentPtyHostIdentity(): PtyHostIdentity {
  return readBakedIdentity("KAVAL");
}

/** The staleKey — the nix-baked hash of kaval's daemon source closure. */
export function currentBuildId(): string {
  return currentPtyHostIdentity().staleKey;
}

/** The navigable git commit this kaval was built from. */
export function currentCommitHash(): string {
  return currentPtyHostIdentity().navigableCommit;
}
