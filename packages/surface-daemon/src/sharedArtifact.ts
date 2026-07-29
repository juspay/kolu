/**
 * One on-disk artifact both daemon generations touch across a mixed-version
 * window (old binary / new supervisor, or the reverse). The type lives here so
 * `daemonHome` can hand back registry entries by construction. Registry-driven
 * matcher, sweep, watchdog, and message machinery lives in the dedicated
 * `@kolu/surface-daemon/upgrade-window.testlib` subpath.
 *
 * Each daemon's inventory array stays consumer-side; only the parameterized
 * machinery is shared.
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
   * Basename of a covering mixed-version disposition test. A `versionField`
   * never replaces this test: the suite must plant version+1 and observe a
   * typed reader state rather than silence. Framework-emitted `daemonHome`
   * entries begin `null` until a consumer registry attaches coverage.
   */
  coveredByTest: string | null;
  /**
   * When non-null, the artifact embeds this named version field. This records
   * the structural discriminator; `coveredByTest` still names the disposition
   * proof for an unknown future version.
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
