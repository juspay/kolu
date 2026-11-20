import { readBakedIdentity } from "@kolu/surface-daemon";
import type { PtyHostIdentity } from "./ptyHostSurface.ts";

/** kaval's full identity — `{ staleKey, navigableCommit }` — read from the `KAVAL_*`
 *  env namespace via the shared recipe. */
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
