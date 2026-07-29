/**
 * Kolu's data-only registry of every on-disk artifact both daemon generations
 * touch. Generic matching, sweeping, messaging, and watchdog logic lives in
 * `@kolu/surface-daemon/upgrade-window.testlib`.
 *
 * Keep this list the single source of truth. When you invent a new path both
 * builds read or write under the state-root / runtime rendezvous, ADD IT HERE
 * (with `diskBasenames` if it is a real file) and register a covering test.
 * Versioned entries additionally declare the reader outcome that test proves.
 */

export type { SharedArtifact } from "@kolu/surface-daemon";
import type { SharedArtifact } from "@kolu/surface-daemon";

/**
 * The inventory. Coverage is filled by the tests that land with this PR; a
 * later shared file without an entry here is the watchdog's job to refuse —
 * both when listed without coverage AND when found on disk unlisted.
 */
export const SHARED_ARTIFACTS: readonly SharedArtifact[] = [
  {
    id: "kaval-gate",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/kaval.pid",
    role: "gate",
    coveredByTest: "surface-daemon-supervisor/recycleForeignGate.test.ts",
    versionField: null,
    diskBasenames: ["kaval.pid"],
    diskBasenamePatterns: [],
    why: "Single-instance pid gate both the old daemon and the new supervisor read; a foreign shape must not silently no-op recycle.",
  },
  {
    id: "kaval-socket",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/pty-host.sock",
    role: "socket",
    coveredByTest: "surface-daemon-supervisor/socketContractMismatch.test.ts",
    versionField: null,
    diskBasenames: ["pty-host.sock"],
    diskBasenamePatterns: [],
    why: "Wire rendezvous; contract version is negotiated over the socket (system.version), not the path.",
  },
  {
    id: "kaval-state-root-manifest",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/state-root",
    role: "manifest",
    coveredByTest: "padi/yesterdayDaemon.test.ts",
    versionField: null,
    diskBasenames: ["state-root"],
    diskBasenamePatterns: [],
    why: "Maps an opaque digest back to the persistent state-root both generations share.",
  },
  {
    id: "padi-gate",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.pid",
    role: "gate",
    coveredByTest: "surface-daemon-supervisor/recycleForeignGate.test.ts",
    versionField: null,
    diskBasenames: ["padi.pid"],
    diskBasenamePatterns: [],
    why: "Padi's own single-instance gate — same file format as kaval's, same foreign-gate disposition.",
  },
  {
    id: "padi-supervisor-gate",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/supervisor.pid",
    role: "gate",
    coveredByTest: "surface-daemon-supervisor/recycleForeignGate.test.ts",
    versionField: null,
    diskBasenames: ["supervisor.pid"],
    diskBasenamePatterns: [],
    why: "The kolu-server ownership claim sits beside padi.pid; old and new supervisors must agree on its pid-gate disposition.",
  },
  {
    id: "padi-socket",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.sock",
    role: "socket",
    coveredByTest: "surface-daemon-supervisor/socketContractMismatch.test.ts",
    versionField: null,
    diskBasenames: ["padi.sock"],
    diskBasenamePatterns: [],
    why: "Padi's serving socket; the binder dials it and must name a contract skew.",
  },
  {
    id: "padi-state-root-config",
    pathShape: "<stateRoot>/config.json",
    role: "config",
    coveredByTest: "padi/sharedArtifacts.watchdog.test.ts",
    versionField: "__internal__.migrations.version (conf projectVersion)",
    versionDisposition: "newer-project-version",
    diskBasenames: ["config.json"],
    diskBasenamePatterns: [],
    why: "Padi's persistent store: session + activityFeed + lastPairedDaemon. Survives deploys; old shape must restore or refuse by name.",
  },
  {
    id: "padi-session-blob",
    pathShape: "<stateRoot>/config.json#session",
    role: "session",
    coveredByTest: "padi/oldSessionFile.test.ts",
    versionField: null,
    // Logical key inside config.json — not a separate file on disk.
    diskBasenames: [],
    diskBasenamePatterns: [],
    why: "The saved-session payload inside the conf store — previous-shape terminals must backfill or refuse, never vanish.",
  },
  {
    id: "kaval-pty-shell-init",
    pathShape:
      "$XDG_RUNTIME_DIR/kaval-<digest>/bashrc-<terminalId> | zdotdir-<terminalId>/.zshrc",
    role: "config",
    // Created when a terminal is spawned (previousRelease.e2e creates one).
    coveredByTest: "padi/previousRelease.e2e.test.ts",
    versionField: null,
    diskBasenames: [],
    // kolu-pty prepareShellInit: bashrc-<uuid> file, or zdotdir-<uuid>/.zshrc
    // under kaval's rcDir (often `<rendezvous>/rc/…` — match anywhere in the
    // relative path, not only at the root of the runtime dir).
    diskBasenamePatterns: [
      /(^|\/)bashrc-[0-9a-f-]{36}$/i,
      /(^|\/)zdotdir-[0-9a-f-]{36}$/i,
      /(^|\/)zdotdir-[0-9a-f-]{36}\/\.zshrc$/i,
    ],
    why: "Per-PTY shell wrapper rcfiles kaval materialises under its rcDir (beside the socket). A mixed-version window must not leave an unaccounted init shape.",
  },
  {
    id: "kaval-log",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/kaval.log",
    role: "log",
    coveredByTest: null,
    versionField: null,
    diskBasenames: ["kaval.log", "kaval.log.old"],
    diskBasenamePatterns: [/^kaval\.log(\.\d+)?(\.old)?$/],
    why: "Diagnostic stderr capture beside the socket — not a protocol surface.",
  },
  {
    id: "padi-log",
    pathShape: "<stateRoot>/padi.log",
    role: "log",
    coveredByTest: null,
    versionField: null,
    diskBasenames: ["padi.log"],
    // pino-roll keeps 3 generations: padi.log, padi.log.1, padi.log.2, …
    diskBasenamePatterns: [/^padi\.log(?:\.\d+)?(?:\.old)?$/],
    why: "Diagnostic pino stream under the state-root — not a protocol surface.",
  },
  {
    id: "padi-stderr-log",
    pathShape: "<stateRoot>/padi.stderr.log",
    role: "log",
    coveredByTest: null,
    versionField: null,
    diskBasenames: ["padi.stderr.log", "padi.stderr.log.old"],
    diskBasenamePatterns: [/^padi\.stderr\.log(\.old)?$/],
    why: "Crash-catcher stderr — not a protocol surface.",
  },
] as const;
