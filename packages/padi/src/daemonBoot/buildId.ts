import {
  type DaemonBuildIdentity,
  readBakedIdentity,
} from "@kolu/surface-daemon";

/** padi's full build identity — `{ staleKey, navigableCommit }` — read from the
 *  `PADI_*` env namespace nix bakes. Off-nix both fields are `""`: the readout
 *  shows nothing rather than inventing an identity. */
export function currentPadiBuildIdentity(): DaemonBuildIdentity {
  return readBakedIdentity("PADI");
}

/** padi's staleKey — the nix-baked hash of padi's daemon source closure. It
 *  flips iff a restart would load different daemon code (NOT the padiSurface
 *  contract version a binder's upgrade decision reads). */
export function currentPadiBuildId(): string {
  return currentPadiBuildIdentity().staleKey;
}

/** The navigable git commit this padi was built from. */
export function currentPadiCommitHash(): string {
  return currentPadiBuildIdentity().navigableCommit;
}
