/**
 * The running daemon's baked build identity — the ONE recipe both daemons' build-id
 * reads share, replacing the per-package `buildId.ts` twins (kaval's `KAVAL_*`, padi's
 * `PADI_*`). A daemon reads its OWN identity-env namespace by PREFIX, so the package
 * keeps zero coupling to its host (the graduation rule): kaval reads `KAVAL_*`, padi
 * reads `PADI_*`, and a future daemon passes its own prefix.
 *
 * Two fields, two axes:
 *   - `staleKey` — the nix-baked hash of the daemon's source closure (`<PREFIX>_BUILD_ID`).
 *     It flips iff a restart would load different code; this is the daemon's CURRENCY
 *     axis (a build-mismatch is what the convergence kit's build trigger compares —
 *     match-only, NEVER ordered: store hashes don't order).
 *   - `navigableCommit` — the git ref it was built from (`<PREFIX>_COMMIT_HASH`), the
 *     GitHub-clickable identity a UI surfaces.
 *
 * Nix-first: off-nix (raw `vitest`, or a build without the env) both are `""` — the
 * readout shows nothing rather than inventing an identity, and every currency /
 * convergence check reads an empty id as the honest "unknown" (never a false match,
 * never an invented mismatch). A half-baked pair is contradictory: a Nix build id
 * means the source commit was knowable, so either both fields are present or neither
 * is. This lives in `@kolu/surface-daemon` (the daemon spine
 * both daemons already import) rather than either daemon package, so the read pattern
 * exists once; a daemon can't depend on the client-side supervisor, so the primitive
 * that BOTH the daemon (serving its identity) and the supervisor (baking its expected
 * identity) read belongs on the daemon side of the arrow.
 */

/** A daemon's baked build identity — its currency `staleKey` + its navigable git commit. */
export interface DaemonBuildIdentity {
  /** The nix-baked source-closure hash (`<PREFIX>_BUILD_ID`); `""` off-nix. */
  staleKey: string;
  /** The navigable git commit (`<PREFIX>_COMMIT_HASH`); `""` off-nix. */
  navigableCommit: string;
}

/** Read a daemon's baked build identity from its `<PREFIX>_*` env namespace — the one
 *  recipe kaval (`"KAVAL"`) and padi (`"PADI"`) share. Both absent → `""` (honest
 *  "unknown"), never a fabricated id. Exactly one present is a contradictory build
 *  and throws during boot. */
export function readBakedIdentity(prefix: string): DaemonBuildIdentity {
  const buildEnv = `${prefix}_BUILD_ID`;
  const commitEnv = `${prefix}_COMMIT_HASH`;
  const staleKey = process.env[buildEnv];
  const navigableCommit = process.env[commitEnv];
  const neitherBaked = staleKey === undefined && navigableCommit === undefined;
  if (neitherBaked) return { staleKey: "", navigableCommit: "" };
  if (!staleKey || !navigableCommit) {
    throw new Error(
      `incomplete baked identity: ${buildEnv} and ${commitEnv} must be set together`,
    );
  }
  return { staleKey, navigableCommit };
}
