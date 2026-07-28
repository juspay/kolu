/**
 * Inventory of every on-disk artifact BOTH daemon generations touch across a
 * mixed-version window (old kaval / new padi, or the reverse). The watchdog
 * asserts two things:
 *
 *   1. Coverage — every non-log inventory entry has a covering mixed-version
 *      test OR an explicit version field.
 *   2. Grounding — after real daemons boot, every non-log file present under
 *      the runtime dir + state-root matches an inventory entry. An unknown
 *      file is red with instructions (the hand-list-only miss this suite
 *      exists to catch).
 *
 * Keep this list the single source of truth. When you invent a new path both
 * builds read or write under the state-root / runtime rendezvous, ADD IT HERE
 * (with `diskBasenames` if it is a real file) and either register a covering
 * test or declare its version field.
 */

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

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
  /**
   * Exact basenames this artifact may appear as on disk under the runtime
   * dir or state-root. Empty for logical entries that ride inside another
   * file (e.g. the session key inside config.json) or for pattern-only
   * entries (see `diskBasenamePatterns`).
   */
  diskBasenames: readonly string[];
  /**
   * Regex patterns matched against the basename OR the relative path from
   * the runtime/state-root (e.g. `bashrc-<uuid>`, `zdotdir-<uuid>/.zshrc`,
   * `padi.log.1`). Use for per-entity / rotated names that cannot be
   * listed exhaustively.
   */
  diskBasenamePatterns: readonly RegExp[];
  /** Why this file is shared across generations. */
  why: string;
}

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
    coveredByTest: "recycleForeignGate.test.ts",
    versionField: null,
    diskBasenames: ["kaval.pid"],
    diskBasenamePatterns: [],
    why: "Single-instance pid gate both the old daemon and the new supervisor read; a foreign shape must not silently no-op recycle.",
  },
  {
    id: "kaval-socket",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/pty-host.sock",
    role: "socket",
    coveredByTest: "socketContractMismatch.test.ts",
    versionField: null,
    diskBasenames: ["pty-host.sock"],
    diskBasenamePatterns: [],
    why: "Wire rendezvous; contract version is negotiated over the socket (system.version), not the path.",
  },
  {
    id: "kaval-state-root-manifest",
    pathShape: "$XDG_RUNTIME_DIR/kaval-<digest>/state-root",
    role: "manifest",
    coveredByTest: "yesterdayDaemon.test.ts",
    versionField: null,
    diskBasenames: ["state-root"],
    diskBasenamePatterns: [],
    why: "Maps an opaque digest back to the persistent state-root both generations share.",
  },
  {
    id: "padi-gate",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.pid",
    role: "gate",
    coveredByTest: "recycleForeignGate.test.ts",
    versionField: null,
    diskBasenames: ["padi.pid"],
    diskBasenamePatterns: [],
    why: "Padi's own single-instance gate — same file format as kaval's, same foreign-gate disposition.",
  },
  {
    id: "padi-socket",
    pathShape: "$XDG_RUNTIME_DIR/padi-<digest>/padi.sock",
    role: "socket",
    coveredByTest: "socketContractMismatch.test.ts",
    versionField: null,
    diskBasenames: ["padi.sock"],
    diskBasenamePatterns: [],
    why: "Padi's serving socket; the binder dials it and must name a contract skew.",
  },
  {
    id: "padi-state-root-config",
    pathShape: "<stateRoot>/config.json",
    role: "config",
    coveredByTest: "oldSessionFile.test.ts",
    versionField: "projectVersion (conf, PADI_STATE_SCHEMA_VERSION)",
    diskBasenames: ["config.json"],
    diskBasenamePatterns: [],
    why: "Padi's persistent store: session + activityFeed + lastPairedDaemon. Survives deploys; old shape must restore or refuse by name.",
  },
  {
    id: "padi-session-blob",
    pathShape: "<stateRoot>/config.json#session",
    role: "session",
    coveredByTest: "oldSessionFile.test.ts",
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
    coveredByTest: "previousRelease.e2e.test.ts",
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
    diskBasenamePatterns: [/^padi\.log(\.\d+)?$/],
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

/** Every exact on-disk basename the inventory lists (log + non-log). */
export function knownDiskBasenames(): Set<string> {
  const s = new Set<string>();
  for (const a of SHARED_ARTIFACTS) {
    for (const b of a.diskBasenames) s.add(b);
  }
  return s;
}

/** Does `name` (basename or relative path) match any inventory entry? */
export function matchesInventory(name: string): boolean {
  const base = basename(name);
  if (knownDiskBasenames().has(base) || knownDiskBasenames().has(name)) {
    return true;
  }
  for (const a of SHARED_ARTIFACTS) {
    for (const re of a.diskBasenamePatterns) {
      if (re.test(base) || re.test(name)) return true;
    }
  }
  return false;
}

/**
 * Is this name a diagnostic log (or a rotate sibling)? Inventory log entries
 * + a conservative `.log` / `.log.N` / `.log.old` heuristic.
 */
export function isLogName(name: string): boolean {
  const base = basename(name);
  for (const a of SHARED_ARTIFACTS) {
    if (a.role !== "log") continue;
    if (a.diskBasenames.includes(base)) return true;
    for (const re of a.diskBasenamePatterns) {
      if (re.test(base) || re.test(name)) return true;
    }
  }
  if (base.endsWith(".log") || base.endsWith(".log.old")) return true;
  if (/^[\w.-]+\.log\.\d+$/.test(base)) return true;
  return false;
}

/** Recursively list relative file paths under `root` (files + sockets). */
export function listRelativeFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, r);
      else if (st.isFile() || st.isSocket()) out.push(r);
    }
  };
  walk(root, "");
  return out;
}

/**
 * Ground the inventory against a live runtime dir + state-root: every non-log
 * file found must match an inventory entry (exact basename or pattern).
 * Unknown protocol files fail with instructions. Returns the list of unknown
 * relative paths (empty = ok) so callers can `expect(unknown).toEqual([])`.
 */
export function unknownProtocolFilesOnDisk(
  runtimeRoot: string,
  stateRoot: string,
): string[] {
  const found = [
    ...listRelativeFilesUnder(runtimeRoot),
    ...listRelativeFilesUnder(stateRoot),
  ];
  const unknown: string[] = [];
  for (const name of found) {
    if (isLogName(name)) continue;
    if (matchesInventory(name)) continue;
    unknown.push(name);
  }
  return unknown.sort();
}

/** Human-readable failure message for an unknown on-disk shared file. */
export function unknownSharedFileMessage(unknown: string[]): string {
  return (
    `Unknown shared on-disk artifact(s) under the daemon runtime/state-root:\n` +
    unknown.map((u) => `  - ${u}`).join("\n") +
    `\n\nAdd an entry to SHARED_ARTIFACTS in sharedArtifacts.testlib.ts with ` +
    `diskBasenames: ["${unknown[0] ?? "…"}"] (and a covering mixed-version ` +
    `test or versionField). A new shared file without either is the miss this ` +
    `watchdog exists to catch.`
  );
}
