/**
 * padi's OWN persistent store — the `Conf` under padi's state-root that backs the
 * `session`, `activityFeed`, and `lastPairedDaemon` cells. Until W2.2 these three
 * were kolu-server's `Conf` keys, INJECTED into padi (`confStores.ts`); now the
 * padi PROCESS owns them, on the host, keyed by its state-root identity.
 *
 * padi does NOT import `packages/server/src/state.ts` (the dependency arrow points
 * OUT) — it builds its own `Conf`, a small twin of the server's, holding only the
 * three keys padi owns. **`preferences` stays kolu-server's** (a koluSurface cell,
 * user-scoped, not padi's); it never moves here.
 *
 * The migration ladder is intentionally empty today: kolu-server ran the legacy
 * ladder before the one-shot import, so padi only needs to persist its current
 * project-version marker and refuse a marker written by a future padi.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Conf from "conf";
import { confStore } from "@kolu/surface/server";
import type { CellStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { openStateBackupRing } from "kolu-shared/state-backup";
import type { PairedDaemon } from "./pairedDaemon.ts";
import type { ActivityFeed, SavedSession } from "../vocab.ts";

/** padi's on-disk shape — the three keys padi owns under its state-root, plus the
 *  one-shot import marker. */
interface PadiPersistedState {
  session: SavedSession | null;
  activityFeed: ActivityFeed;
  lastPairedDaemon: PairedDaemon | null;
  /** Set true once the legacy kolu-config import has run (exactly-once guard). An
   *  internal flag, never a served cell. */
  importedLegacyConfig: boolean;
}

/** padi's state schema version — bump when padi grows its own migration ladder. */
export const PADI_STATE_SCHEMA_VERSION = "1.0.0";

/** The three `CellStore`s padi injects at boot, plus the underlying `Conf` (which
 *  the one-shot import writes into raw). */
export interface PadiStateStores {
  session: CellStore<SavedSession | null>;
  activityFeed: CellStore<ActivityFeed>;
  lastPairedDaemon: CellStore<PairedDaemon | null>;
  /** The raw store — the state-root Conf, exposed so the one-shot import can seed
   *  keys directly (and so a boot can inspect emptiness before importing). */
  conf: PadiConf;
}

/** The padi state-root `Conf` type — narrowed to the read/write surface the
 *  one-shot import needs (import stays decoupled from the full `Conf` API). */
export type PadiConf = Conf<PadiPersistedState>;

/** A future padi has already written this state-root. An older padi must leave
 * the file byte-for-byte alone instead of asking Conf to run its migration
 * ladder backwards. */
export type NewerPadiStateProjectVersion = {
  readonly kind: "newer-project-version";
  readonly configPath: string;
  readonly runningVersion: string;
  readonly supportedVersion: string;
};

/** The only two outcomes of opening padi's state store. */
export type PadiStateStoreOpen =
  | { readonly kind: "ready"; readonly stores: PadiStateStores }
  | NewerPadiStateProjectVersion;

/** The daemon boot surfaces a rollback-window refusal by this stable name. */
export class NewerPadiStateProjectVersionError extends Error {
  constructor(readonly disposition: NewerPadiStateProjectVersion) {
    super(
      `padi state was written by newer project version ${disposition.runningVersion}; ` +
        `this padi supports ${disposition.supportedVersion} (${disposition.configPath} left untouched)`,
    );
    this.name = "NewerPadiStateProjectVersionError";
  }
}

function parseProjectVersion(version: unknown, configPath: string): number[] {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `padi state has invalid project version ${JSON.stringify(version)} in ${configPath}`,
    );
  }
  return version.split(".").map(Number);
}

function projectVersionIsNewer(
  runningVersion: string,
  supportedVersion: string,
  configPath: string,
): boolean {
  const running = parseProjectVersion(runningVersion, configPath);
  const supported = parseProjectVersion(supportedVersion, configPath);
  for (let i = 0; i < running.length; i += 1) {
    if (running[i] !== supported[i]) return running[i]! > supported[i]!;
  }
  return false;
}

function newerProjectVersionOnDisk(
  configPath: string,
): NewerPadiStateProjectVersion | null {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(raw) as {
    __internal__?: { migrations?: { version?: unknown } };
  };
  const runningVersion = parsed.__internal__?.migrations?.version;
  if (runningVersion === undefined) return null;
  if (typeof runningVersion !== "string") {
    throw new Error(
      `padi state has invalid project version ${JSON.stringify(runningVersion)} in ${configPath}`,
    );
  }
  if (
    !projectVersionIsNewer(
      runningVersion,
      PADI_STATE_SCHEMA_VERSION,
      configPath,
    )
  ) {
    return null;
  }
  return {
    kind: "newer-project-version",
    configPath,
    runningVersion,
    supportedVersion: PADI_STATE_SCHEMA_VERSION,
  };
}

/** padi's state file under a state-root — the ONE derivation of that fact. This
 *  module owns padi's on-disk layout (it constructs the `Conf`), so
 *  `openPadiStateStores` and the backup ring's face both read it HERE rather
 *  than each re-spelling `join(stateRoot, "config.json")`: a second spelling
 *  would silently ring a different directory than the boot snapshot writes, and
 *  nothing would fail loudly. */
export function padiConfigPath(stateRoot: string): string {
  return join(stateRoot, "config.json");
}

/** Open padi's state-root `Conf` (`<stateRoot>/config.json`) and return the three
 *  cell stores it backs. The stores are `confStore` adapters over the one `Conf`,
 *  exactly as kolu-server built them — so the cells behave byte-identically, only
 *  the file moved. */
export function openPadiStateStores(stateRoot: string): PadiStateStoreOpen {
  const configPath = padiConfigPath(stateRoot);
  // Snapshot the pre-existing file into the backup ring BEFORE anything —
  // including the rollback preflight and the Conf construction below — can
  // write it (juspay/kolu#1658: history is the safety net for a bug that
  // persists a bad-but-valid value; the migration `.bak`s are one-shot and
  // cover only the legacy cutover). Fail-soft by design — see `stateBackup.ts`.
  openStateBackupRing(configPath, log).snapshot();
  const newer = newerProjectVersionOnDisk(configPath);
  if (newer !== null) return newer;

  const conf = new Conf<PadiPersistedState>({
    cwd: stateRoot,
    projectVersion: PADI_STATE_SCHEMA_VERSION,
    defaults: {
      session: null,
      activityFeed: { recentRepos: [], recentAgents: [] },
      lastPairedDaemon: null,
      importedLegacyConfig: false,
    },
    // Conf persists `projectVersion` only when migrations are enabled. The
    // empty ladder makes the field real today; the preflight above prevents a
    // rollback binary from silently rewriting a future version backwards.
    migrations: {},
  });
  return {
    kind: "ready",
    stores: {
      session: confStore<SavedSession | null>(conf, "session"),
      activityFeed: confStore<ActivityFeed>(conf, "activityFeed"),
      lastPairedDaemon: confStore<PairedDaemon | null>(
        conf,
        "lastPairedDaemon",
      ),
      conf,
    },
  };
}

/** Convenience for test/fixture writers that create only current-version state.
 * Production boot handles the typed outcome itself so the refusal stays visible. */
export function requirePadiStateStores(stateRoot: string): PadiStateStores {
  const opened = openPadiStateStores(stateRoot);
  if (opened.kind === "newer-project-version") {
    throw new NewerPadiStateProjectVersionError(opened);
  }
  return opened.stores;
}
