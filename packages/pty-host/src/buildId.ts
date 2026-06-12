/**
 * The running pty-host's build identity — pure reads of the env nix bakes.
 *
 * `currentBuildId()` is the **staleKey**: a hash of the `@kolu/pty-host` source
 * closure, baked into `KOLU_PTY_HOST_BUILD_ID` by `default.nix` and `--set` on
 * the kolu wrapper. It flips iff a restart would load different pty-host
 * wire/behaviour code — phase B compares it against the server's expected build
 * to derive "update pending", so server-/client-only deploys never nudge.
 *
 * `currentCommitHash()` is the **navigableCommit**: the git ref this kolu was
 * built from (`KOLU_COMMIT_HASH`), surfaced to the ChromeBar as the
 * GitHub-clickable identity.
 *
 * Nix is first-class: kolu and the pty-host run only under nix, so there is no
 * dev-derivation fallback. Off-nix (raw `vitest`) the vars are absent and both
 * return `""` — the readout shows nothing rather than inventing an identity.
 * Staleness is never computed here; it is a read-site derivation
 * (`staleKey !== currentBuildId()`) that phase B adds.
 */

import type { PtyHostIdentity } from "kolu-common/surface";

/** The staleKey — the nix-baked hash of the `@kolu/pty-host` source closure. */
export function currentBuildId(): string {
  return process.env.KOLU_PTY_HOST_BUILD_ID ?? "";
}

/** The navigable git commit this kolu was built from. */
export function currentCommitHash(): string {
  return process.env.KOLU_COMMIT_HASH ?? "";
}

/** The pty-host's full identity — `{ staleKey, navigableCommit }` — assembled
 *  at the source that owns the reads, so the field mapping lives in one place.
 *  Phase B's separate daemon reuses this instead of re-deriving the shape. */
export function currentPtyHostIdentity(): PtyHostIdentity {
  return { staleKey: currentBuildId(), navigableCommit: currentCommitHash() };
}
