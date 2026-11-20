import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityFeed, SavedSession } from "@kolu/padi-client/surface";
import { backfillSavedSession } from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import { confStore } from "@kolu/surface/server";
import Conf from "conf";
import {
  openStateBackupRing,
  type StateBackupRing,
} from "kolu-shared/state-backup";
import { log } from "../log.ts";
import type { PairedDaemon } from "./pairedDaemon.ts";

interface PadiPersistedState {
  session: SavedSession | null;
  activityFeed: ActivityFeed;
  lastPairedDaemon: PairedDaemon | null;
  importedLegacyConfig: boolean;
}

export const PADI_STATE_SCHEMA_VERSION = "1.6.0";

/** Delete a key that is no longer in {@link PadiPersistedState} off the raw
 *  store. Conf's typed `delete` rejects a key outside the current shape — which
 *  is exactly the key a rung needs to remove — hence the double-cast. Harmless
 *  when the key is already absent. */
const deleteRetiredKey = (store: Conf<PadiPersistedState>, key: string): void =>
  (store as unknown as { delete: (key: string) => void }).delete(key);

const backfillSavedSessionIn = (store: Conf<PadiPersistedState>): void => {
  const session = store.get("session");
  if (session !== null)
    store.set("session", backfillSavedSession(session) as SavedSession);
};

const dropRecentAgents_1_3_0 = (store: Conf<PadiPersistedState>): void => {
  backfillSavedSessionIn(store);
  const feed = store.get("activityFeed");
  if (feed.recentAgents.length > 0)
    store.set("activityFeed", { ...feed, recentAgents: [] });
};

const noSchemaChange_1_4_0 = (): void => {};

const deleteOrchestrator_1_5_0 = (store: Conf<PadiPersistedState>): void => {
  deleteRetiredKey(store, "orchestrator");
};

const PADI_STATE_MIGRATIONS: Record<
  string,
  (store: Conf<PadiPersistedState>) => void
> = {
  "1.1.0": backfillSavedSessionIn,
  "1.2.0": backfillSavedSessionIn,
  "1.3.0": dropRecentAgents_1_3_0,
  "1.4.0": noSchemaChange_1_4_0,
  "1.5.0": deleteOrchestrator_1_5_0,
  "1.6.0": backfillSavedSessionIn,
};

export interface PadiStateStores {
  session: CellStore<SavedSession | null>;
  activityFeed: CellStore<ActivityFeed>;
  lastPairedDaemon: CellStore<PairedDaemon | null>;
  conf: PadiConf;
  ring: StateBackupRing;
}

export type PadiConf = Conf<PadiPersistedState>;

export type NewerPadiStateProjectVersion = {
  readonly kind: "newer-project-version";
  readonly configPath: string;
  readonly runningVersion: string;
  readonly supportedVersion: string;
};

export type PadiStateStoreOpen =
  | { readonly kind: "ready"; readonly stores: PadiStateStores }
  | NewerPadiStateProjectVersion;

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

export function padiConfigPath(stateRoot: string): string {
  return join(stateRoot, "config.json");
}

export function padiStateBackupRing(stateRoot: string): StateBackupRing {
  return openStateBackupRing(padiConfigPath(stateRoot), log);
}

export function openPadiStateStores(stateRoot: string): PadiStateStoreOpen {
  const configPath = padiConfigPath(stateRoot);
  const ring = openStateBackupRing(configPath, log);
  ring.snapshot();
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
    // Conf persists `projectVersion` only when migrations are enabled; the
    // preflight above prevents a rollback binary from silently rewriting a
    // future version backwards.
    migrations: PADI_STATE_MIGRATIONS,
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
      ring,
    },
  };
}

export function requirePadiStateStores(stateRoot: string): PadiStateStores {
  const opened = openPadiStateStores(stateRoot);
  if (opened.kind === "newer-project-version") {
    throw new NewerPadiStateProjectVersionError(opened);
  }
  return opened.stores;
}
