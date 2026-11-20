import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backfillActivityFeed,
  backfillSavedSession,
} from "@kolu/padi-client/surface";
import type { Logger } from "@kolu/surface-daemon";
import type { PadiStateStores } from "./stateStore.ts";

const IMPORTED_KEYS = ["session", "activityFeed", "lastPairedDaemon"] as const;

function readConfigJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function importLegacyConfigOnce(
  stores: PadiStateStores,
  log: Logger,
): void {
  const { conf } = stores;
  if (conf.get("importedLegacyConfig")) return;

  if (stores.session.get() != null) {
    conf.set("importedLegacyConfig", true);
    log.warn(
      { legacyStateDir: process.env.KOLU_STATE_DIR ?? null },
      "padi already holds its own session — skipping the legacy import (padi's accrued state wins over the shared config.json; marked done so no later bind re-scans)",
    );
    return;
  }

  const legacyStateDir = process.env.KOLU_STATE_DIR;
  if (!legacyStateDir) return;

  const oldPath = join(legacyStateDir, "config.json");
  if (!existsSync(oldPath)) {
    conf.set("importedLegacyConfig", true);
    return;
  }

  const live = readConfigJson(oldPath);
  const stripBackupPath = `${oldPath}.pre-1.31-strip.bak`;
  const liveHasLegacy = IMPORTED_KEYS.some((key) => key in live);

  let raw = live;
  let sourcePath = oldPath;
  if (!liveHasLegacy && existsSync(stripBackupPath)) {
    raw = readConfigJson(stripBackupPath);
    sourcePath = stripBackupPath;
  } else {
    const backupPath = `${oldPath}.pre-padi-import.bak`;
    if (!existsSync(backupPath)) copyFileSync(oldPath, backupPath);
  }

  for (const key of IMPORTED_KEYS) {
    if (key in raw) {
      const value =
        key === "session"
          ? backfillSavedSession(raw[key])
          : key === "activityFeed"
            ? backfillActivityFeed(raw[key])
            : raw[key];
      // biome-ignore lint/suspicious/noExplicitAny: seeding a raw blob key into the typed Conf; the old file's shape is validated by kolu-server's ladder, not re-parsed here.
      conf.set(key, value as any);
    }
  }
  conf.set("importedLegacyConfig", true);
  log.info(
    { sourcePath, keys: IMPORTED_KEYS },
    "imported legacy kolu config into padi's state-root (one-shot)",
  );
}
