/**
 * Baked identity — the block "How to bake an identity" and the
 * `@kolu/surface-daemon` reference embed. `readBakedIdentity(prefix)` is the one
 * recipe both a daemon's identity reads share; it returns the two axes a
 * supervisor recognises a daemon by across a restart.
 */

import { readBakedIdentity } from "@kolu/surface-daemon";

// #region read
export function currentIdentity() {
  return readBakedIdentity("KAVAL"); // reads KAVAL_BUILD_ID / KAVAL_COMMIT_HASH
}
export const currentBuildId = () => currentIdentity().staleKey;
export const currentCommit = () => currentIdentity().navigableCommit;
// #endregion read
