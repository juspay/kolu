import type { StateBackupEntry } from "kolu-shared/state-backup";
import type {
  ServerBackupsList,
  ServerBackupsRestoreResult,
  ServerStateBackup,
} from "kolu-common/contract";
import type { Preferences, ViewerMode } from "kolu-common/surface";
import type { PersistedMembers, PersistedWorks } from "kolu-conductor";
import { log } from "./log.ts";
import {
  type DecodedStateBackup,
  decodeStateBackup,
  stateBackupRing,
} from "./state.ts";

type _RingEntryMatchesWire =
  StateBackupEntry extends Omit<ServerStateBackup, "summary">
    ? true
    : ["wire shape drifted from kolu-shared's StateBackupEntry"];
const _ringEntryMatchesWire: _RingEntryMatchesWire = true;
void _ringEntryMatchesWire;

export function listServerStateBackups(): ServerBackupsList {
  return {
    backups: stateBackupRing.listWith<ServerStateBackup["summary"]>(
      (raw) => {
        const hosts = (raw as { hosts?: unknown }).hosts;
        const works = (raw as { works?: unknown }).works;
        return {
          kind: "state",
          hosts: Array.isArray(hosts) ? hosts.length : 0,
          works: Array.isArray(works) ? works.length : 0,
        };
      },
      { kind: "unreadable" },
    ),
  };
}

export interface RestoreServerStateBackupDeps {
  setPreferences: (value: Preferences) => void;
  setViewerMode: (value: ViewerMode) => void;
  currentHostKeys: () => readonly string[];
  hasLiveHost: (key: string) => boolean;
  addHostKey: (key: string) => Promise<void>;
  removeHostKey: (key: string) => Promise<void>;
  restoreWorks: (works: PersistedWorks, members: PersistedMembers) => void;
}

const RESTORED_PERSISTED_KEYS = [
  "preferences",
  "viewerMode",
  "hosts",
  "works",
  "members",
] as const;

const KEYS_WITH_NO_RESTORE_PATH = ["conductor"] as const;

type UnrestoredPersistedKey = Exclude<
  keyof DecodedStateBackup,
  | (typeof RESTORED_PERSISTED_KEYS)[number]
  | (typeof KEYS_WITH_NO_RESTORE_PATH)[number]
>;
const _everyPersistedKeyRestored: [UnrestoredPersistedKey] extends [never]
  ? true
  : ["restore path missing for", UnrestoredPersistedKey] = true;
void _everyPersistedKeyRestored;

export async function restoreServerStateBackup(
  input: { file: string },
  deps: RestoreServerStateBackupDeps,
): Promise<ServerBackupsRestoreResult> {
  return await stateBackupRing.restore(input.file, async (raw) => {
    const decoded = decodeStateBackup(raw, input.file);
    log.info({ file: input.file }, "restoring server state from backup");
    deps.setPreferences(decoded.preferences);
    deps.setViewerMode(decoded.viewerMode);
    deps.restoreWorks(decoded.works, decoded.members);

    const target = new Set(decoded.hosts);
    const current = new Set(deps.currentHostKeys());
    const attempt = async (
      verb: "add" | "remove",
      key: string,
      run: (key: string) => Promise<void>,
    ): Promise<string | null> => {
      try {
        await run(key);
        return null;
      } catch (err) {
        log.error({ err, host: key }, `state restore: host ${verb} failed`);
        return `${verb} ${key}: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
    const addFailures = await Promise.all(
      decoded.hosts
        .filter((key) => !current.has(key) && !deps.hasLiveHost(key))
        .map((key) => attempt("add", key, deps.addHostKey)),
    );
    const removeFailures = await Promise.all(
      [...current]
        .filter((key) => !target.has(key))
        .map((key) => attempt("remove", key, deps.removeHostKey)),
    );
    return {
      hostFailures: [...addFailures, ...removeFailures].filter(
        (failure): failure is string => failure !== null,
      ),
    };
  });
}
