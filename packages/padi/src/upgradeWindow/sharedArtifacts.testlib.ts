/**
 * Inventory of every on-disk artifact BOTH daemon generations touch across a
 * mixed-version window (old kaval / new padi, or the reverse). The watchdog
 * (`sharedArtifacts.watchdog.test.ts`) asserts each entry is either covered by
 * a named mixed-version test in this suite OR carries an explicit version
 * field — so adding a new shared file without either fails loudly with
 * instructions.
 *
 * Keep this list the single source of truth. When you invent a new path both
 * builds read or write under the state-root / runtime rendezvous, ADD IT HERE
 * and either register a covering test or declare its version field.
 */

/** One shared artifact the upgrade-window suite must account for. */
export interface SharedArtifact {
  /** Stable id used by the watchdog + coverage registry. */
  id: string;
  /** Human path shape (not a literal — digests/ports vary). */
  pathShape: string;
  /** What the file is for. */
  role: "gate" | "socket" | "session" | "config" | "manifest" | "log";
  /**
   * Either the basename of a covering mixed-version test under
   * `packages/padi/src/upgradeWindow/`, or `null` when the artifact itself
   * carries a version field (see `versionField`).
   */
  coveredByTest: string | null;
  /**
   * When non-null, the artifact embeds this named version field (no separate
   * mixed-version test required — a version-skew is structural).
   */
  versionField: string | null;
  /** Why this file is shared across generations. */
  why: string;
}

/**
 * The inventory. Coverage is filled by the tests that land with this PR; a
 * later shared file without an entry here is the watchdog's job to refuse.
 */
export const SHARED_ARTIFACTS: readonly SharedArtifact[] = [
  {
    id: "kaval-gate",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/kaval.pid",
    role: "gate",
    coveredByTest: "recycleForeignGate.test.ts",
    versionField: null,
    why: "Single-instance pid gate both the old daemon and the new supervisor read; a foreign shape must not silently no-op recycle.",
  },
  {
    id: "kaval-socket",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/pty-host.sock",
    role: "socket",
    coveredByTest: "socketContractMismatch.test.ts",
    versionField: null,
    why: "Wire rendezvous; contract version is negotiated over the socket (system.version), not the path.",
  },
  {
    id: "kaval-state-root-manifest",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/state-root",
    role: "manifest",
    coveredByTest: "yesterdayDaemon.test.ts",
    versionField: null,
    why: "Maps an opaque digest back to the persistent state-root both generations share.",
  },
  {
    id: "padi-gate",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.pid",
    role: "gate",
    coveredByTest: "recycleForeignGate.test.ts",
    versionField: null,
    why: "Padi's own single-instance gate — same file format as kaval's, same foreign-gate disposition.",
  },
  {
    id: "padi-socket",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.sock",
    role: "socket",
    coveredByTest: "socketContractMismatch.test.ts",
    versionField: null,
    why: "Padi's serving socket; the binder dials it and must name a contract skew.",
  },
  {
    id: "padi-state-root-config",
    pathShape: "<stateRoot>/config.json",
    role: "config",
    coveredByTest: "oldSessionFile.test.ts",
    versionField: "projectVersion (conf, PADI_STATE_SCHEMA_VERSION)",
    why: "Padi's persistent store: session + activityFeed + lastPairedDaemon. Survives deploys; old shape must restore or refuse by name.",
  },
  {
    id: "padi-session-blob",
    pathShape: "<stateRoot>/config.json#session",
    role: "session",
    coveredByTest: "oldSessionFile.test.ts",
    versionField: null,
    why: "The saved-session payload inside the conf store — previous-shape terminals must backfill or refuse, never vanish.",
  },
  {
    id: "kaval-log",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/kaval.log",
    role: "log",
    // Logs are best-effort diagnostics, not a versioned protocol surface.
    // Covered by the fixture planting them is unnecessary; declare no test
    // but mark as version-free diagnostic (watchdog accepts role === "log"
    // without coverage — see the watchdog).
    coveredByTest: null,
    versionField: null,
    why: "Diagnostic stderr capture beside the socket — not a protocol surface.",
  },
  {
    id: "padi-log",
    pathShape: "<stateRoot>/padi.log",
    role: "log",
    coveredByTest: null,
    versionField: null,
    why: "Diagnostic pino stream under the state-root — not a protocol surface.",
  },
  {
    id: "padi-stderr-log",
    pathShape: "<stateRoot>/padi.stderr.log",
    role: "log",
    coveredByTest: null,
    versionField: null,
    why: "Crash-catcher stderr — not a protocol surface.",
  },
] as const;
