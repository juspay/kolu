/**
 * The running padi daemon's build identity — pure reads of the env nix bakes.
 *
 * `currentPadiBuildId()` is padi's **staleKey**: a hash of padi's daemon source
 * closure (the package plus its daemon-side roots), baked into `PADI_BUILD_ID` by
 * `default.nix` and `--set` on padi's own bin wrapper. It flips iff a restart
 * would load different daemon code — the "package = process = restart-hash"
 * identity the W1 seam drew and W2.2 turns into a real process. (A binder's
 * upgrade decision is on the padiSurface *contract* version, not this hash —
 * this is the closure/currency identity, distinct from wire-compat.)
 *
 * `currentPadiCommitHash()` is the navigable git ref padi was built from
 * (`PADI_COMMIT_HASH`). padi reads its OWN identity-env namespace (`PADI_*`, not
 * kolu's `KOLU_COMMIT_HASH` nor kaval's `KAVAL_*`) so the package keeps zero
 * coupling to its host — the graduation rule the seal enforces.
 *
 * Off-nix (raw `vitest`, or a padi built without the env) the vars are absent and
 * both return `""` — the readout shows nothing rather than inventing an identity.
 *
 * The env-read RECIPE is shared with kaval via `readBakedIdentity` in
 * `@kolu/surface-daemon` (padi passes prefix `PADI`, kaval `KAVAL`); these are the thin
 * padi-prefixed façade over it, so the public `currentPadiBuildId` /
 * `currentPadiCommitHash` / `currentPadiBuildIdentity` names its callers use are unchanged.
 */

import {
  type DaemonBuildIdentity,
  readBakedIdentity,
} from "@kolu/surface-daemon";

/** padi's full build identity — `{ staleKey, navigableCommit }` — read from the
 *  `PADI_*` env namespace via the shared `readBakedIdentity` recipe (the same one
 *  kaval's `currentPtyHostIdentity` uses, prefixed `KAVAL`), so the env-read pattern
 *  and the `{ staleKey, navigableCommit }` shape live once, in `@kolu/surface-daemon`. */
export function currentPadiBuildIdentity(): DaemonBuildIdentity {
  return readBakedIdentity("PADI");
}

/** padi's staleKey — the nix-baked hash of padi's daemon source closure. */
export function currentPadiBuildId(): string {
  return currentPadiBuildIdentity().staleKey;
}

/** The navigable git commit this padi was built from. */
export function currentPadiCommitHash(): string {
  return currentPadiBuildIdentity().navigableCommit;
}
