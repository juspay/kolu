/**
 * One on-disk artifact both daemon generations touch across a mixed-version
 * window (old binary / new supervisor, or the reverse). The type lives here so
 * `daemonHome` can hand back registry entries by construction; the matcher /
 * sweep machinery that consumes a registry of these lands with UW2.
 *
 * Kolu's inventory array stays app-side (`packages/padi/src/upgradeWindow/`)
 * until UW2 moves the generic matchers into this package.
 */

/** One shared artifact an upgrade-window suite must account for. */
export interface SharedArtifact {
  /** Stable id used by the watchdog + coverage registry. */
  id: string;
  /** Human path shape (not a literal — digests/ports vary). */
  pathShape: string;
  /** What the file is for. */
  role: "gate" | "socket" | "session" | "config" | "manifest" | "log";
  /**
   * Basename of a covering mixed-version test, or `null` when the artifact
   * itself carries a version field (see `versionField`) or coverage is still
   * pending (a framework-emitted entry from `daemonHome` starts with `null`).
   */
  coveredByTest: string | null;
  /**
   * When non-null, the artifact embeds this named version field (no separate
   * mixed-version test required — a version-skew is structural).
   */
  versionField: string | null;
  /**
   * Exact basenames this artifact may appear as on disk under the runtime
   * dir or state-root. Empty for logical entries that ride inside another
   * file, or for pattern-only entries (see `diskBasenamePatterns`).
   */
  diskBasenames: readonly string[];
  /**
   * Regex patterns matched against the basename OR the relative path from
   * the runtime/state-root. Use for per-entity / rotated names that cannot
   * be listed exhaustively.
   */
  diskBasenamePatterns: readonly RegExp[];
  /** Why this file is shared across generations. */
  why: string;
}
