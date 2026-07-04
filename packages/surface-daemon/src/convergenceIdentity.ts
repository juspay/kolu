/**
 * Daemon CONVERGENCE identity + its comparators — the two axes a supervisor compares to
 * decide whether a running daemon is the one it would spawn.
 *
 * These live in `@kolu/surface-daemon` (beside `buildIdentity.ts`) rather than the
 * supervisor that USES them, for one concrete reason: the supervisor
 * (`@kolu/surface-daemon-supervisor`) keeps a deliberate zero-`@kolu/surface` boundary
 * (`deps.closure.test.ts`), and `contractIsCompatible` REUSES `@kolu/surface`'s canonical
 * version-compat predicate rather than forking it. So the comparators sit on the daemon
 * side of the arrow (surface-daemon already deps `@kolu/surface`), and the supervisor's
 * decision layer imports them UP. This package's whole `src/` is re-exported from its
 * barrel, so a daemon's closure walk reaches these even though only a supervisor calls
 * them (they are loaded when the barrel is imported).
 *
 * Pin 2 (ordering is per-field law, make-illegal-unrepresentable):
 *   - `contractVersion` is ORDERED — a `major.minor` wire version. The supervisor asks
 *     "am I newer than the running daemon?" ({@link contractIsNewer}) and "are we
 *     compatible?" ({@link contractIsCompatible}). Ordering is meaningful: a newer
 *     supervisor may supersede an older daemon.
 *   - `buildId` is NEVER ordered — a content hash of the daemon's source closure. Store
 *     hashes DON'T order; there is no "newer build". The ONLY question is match vs
 *     mismatch ({@link buildIdMatches}). This module exports NO build-id ordering, and
 *     `convergenceIdentity.test.ts` pins that a consumer cannot spell one — so a
 *     build-mismatch policy can only ever be "same or different", never "newer/older".
 */

import { isContractVersionCompatible } from "@kolu/surface/define";

/** A running/expected daemon's convergence identity — the two axes the decision keys on.
 *  `buildId` is the daemon's staleKey (its `<PREFIX>_BUILD_ID`); `""` means off-nix /
 *  a survivor predating the field (an honest "unknown" the decision table handles as a
 *  row, never a fabricated match). */
export interface ConvergenceIdentity {
  /** The `major.minor` wire-contract version — ORDERED. */
  contractVersion: string;
  /** The source-closure staleKey — MATCH-ONLY, never ordered. `""` = unknown. */
  buildId: string;
}

/** Parse a `major.minor` version into its two numbers, FAIL-FAST: an unparseable version
 *  is a bug (a daemon always sends a valid `major.minor`, and the supervisor's expected
 *  version is a build constant), so crash loudly rather than silently ordering garbage.
 *  Distinct from `isContractVersionCompatible`'s tolerant fail-closed parse — here we are
 *  ORDERING two versions already proven to be a skew, and a silent mis-parse would pick
 *  the wrong convergence arm. */
function parseMajorMinor(v: string): [number, number] {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) {
    throw new Error(
      `daemon contract version is not a major.minor string: ${JSON.stringify(v)}`,
    );
  }
  return [Number(m[1]), Number(m[2])];
}

/** Are two contract versions wire-compatible (same major, running minor ≥ mine)? The
 *  supervisor's version-skew gate — reuses `@kolu/surface`'s canonical predicate unchanged
 *  (no fork of the ordering rule). */
export function contractIsCompatible(mine: string, running: string): boolean {
  return isContractVersionCompatible(running, mine);
}

/**
 * Is `mine` STRICTLY NEWER than `running` — the ordered arm of contract convergence? Both
 * `major.minor`. Newer = a higher major, or an equal major with a higher minor.
 *
 * Only meaningful on a proven SKEW: the compatible case already adopts and never reaches
 * here, so on a skew the two are never equal and this is a strict ordering. Equal inputs
 * return `false` (a defensive floor, so a caller can never mistake "same version" for
 * "supersede it"). The asymmetry is the anti-livelock monotonicity for the contract axis:
 * only the strictly-newer supervisor ever supersedes, so two supervisors at different
 * versions converge to the newest and never oscillate.
 */
export function contractIsNewer(mine: string, running: string): boolean {
  const [myMajor, myMinor] = parseMajorMinor(mine);
  const [rMajor, rMinor] = parseMajorMinor(running);
  if (myMajor !== rMajor) return myMajor > rMajor;
  return myMinor > rMinor;
}

/**
 * Do two build ids MATCH — the only comparison the build axis permits (Pin 2).
 *
 * A match requires both non-empty AND equal. An empty id (`""`) is an honest "unknown"
 * (off-nix, or a survivor predating the field), never a match: two "unknown"s are not
 * proven-the-same, so the decision table treats an empty id as its caller-specific
 * "can't judge" / "absent == mismatch" row — this predicate itself never invents a match
 * from missing identity. There is deliberately NO `buildIdIsNewer` / `buildIdCompare`:
 * store hashes don't order.
 */
export function buildIdMatches(a: string, b: string): boolean {
  return a !== "" && b !== "" && a === b;
}
