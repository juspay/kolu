/**
 * The one-shot import of kolu-server's legacy config into padi's state-root.
 *
 * Before W2.2, session / activityFeed / lastPairedDaemon lived in kolu-server's
 * single `Conf` (`$KOLU_STATE_DIR/config.json`), shared by every instance on the
 * box — which is exactly how a dev instance and the deployed one once co-wrote
 * one file and nulled it. The state-root ends that collision by giving each padi
 * its OWN store; the cutover carries the existing data across ONCE.
 *
 * The rules (padi.mdx §cutover):
 *   - **whose config wins** = the importing padi takes the old file AS-IS, once,
 *     then never falls back. Exactly-once is guarded by an `importedLegacyConfig`
 *     marker in padi's own store.
 *   - **a failed import CRASHES loudly** (fail-fast) rather than silently starting
 *     empty — a corrupt/half-written old file must surface, not vanish the session.
 *   - **the backup runs BEFORE padi seeds from the file** — a byte copy to
 *     `config.json.pre-padi-import.bak`, once — so a wrong whose-config-wins pick
 *     (or a bad migration in the old file) stays recoverable. (This is the inline
 *     safeguard that replaced the standalone #1658 backup: a few lines, here.)
 *   - **a DIRECT pre-W2.2 → W2.3 upgrade imports from the strip-backup** — W2.3's
 *     kolu-server `1.31.0` migration strips session/activityFeed off `config.json`
 *     on its OWN boot (backup-first, leaving `config.json.pre-1.31-strip.bak`),
 *     which runs BEFORE padi's first boot. So when padi finds the live file
 *     already stripped, it reads the byte-exact pre-strip backup instead — the
 *     intended source, at zero loss, not a fallback knob (see below).
 *
 * `preferences` is NOT imported — it stays kolu-server's (a koluSurface cell).
 */

import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "@kolu/surface-daemon";
import type { PadiStateStores } from "./stateStore.ts";

/** The three keys padi owns and imports from the legacy file. `preferences` is
 *  deliberately absent — it never leaves kolu-server. */
const IMPORTED_KEYS = ["session", "activityFeed", "lastPairedDaemon"] as const;

/** Parse a legacy `config.json` (or its backup) to a raw object. A malformed file
 *  THROWS (fail-fast) — padi crashes rather than serving an empty session; the
 *  byte backups are the recovery path. */
function readConfigJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Seed padi's state-root store from kolu-server's legacy `config.json` — ONCE.
 *  A no-op after the first successful run (the marker), when there is no
 *  `$KOLU_STATE_DIR` (a dev/e2e padi with no legacy to carry), or when the old
 *  file is absent. Crashes loudly on a malformed old file (the backup taken first
 *  makes that recoverable). Call BEFORE the stores are injected/read. */
export function importLegacyConfigOnce(
  stores: PadiStateStores,
  log: Logger,
): void {
  const { conf } = stores;
  // Exactly-once: a fully-successful import sets this last, so a crash mid-import
  // simply retries next boot (idempotent — the seeds overwrite), and padi's own
  // later writes are never clobbered by a re-import.
  if (conf.get("importedLegacyConfig")) return;

  // Clobber guard: a padi that already accrued its OWN session must NEVER be
  // overwritten by a later bind. The window: padi ran STANDALONE (no
  // `$KOLU_STATE_DIR` → the no-legacy path below deliberately leaves the marker
  // UNSET, so a later bind could still carry data across), a user built a workspace
  // in it, and only THEN does kolu-server bind it WITH `$KOLU_STATE_DIR` set — the
  // marker is still unset, so without this the import would clobber padi's live
  // session with the shared `config.json`. padi owns its state now; the legacy file
  // only ever wins a FRESH padi's first boot. So if padi already holds a session,
  // mark done (never re-scan) and skip LOUDLY — padi's accrued state wins.
  if (stores.session.get() != null) {
    conf.set("importedLegacyConfig", true);
    log.warn(
      { legacyStateDir: process.env.KOLU_STATE_DIR ?? null },
      "padi already holds its own session — skipping the legacy import (padi's accrued state wins over the shared config.json; marked done so no later bind re-scans)",
    );
    return;
  }

  const legacyStateDir = process.env.KOLU_STATE_DIR;
  if (!legacyStateDir) return; // a dev/e2e padi with its own fresh state-root

  const oldPath = join(legacyStateDir, "config.json");
  if (!existsSync(oldPath)) {
    // No legacy file to carry — mark done so we never re-scan, start from defaults.
    conf.set("importedLegacyConfig", true);
    return;
  }

  // Read the live file first (a malformed old file THROWS — fail-fast). Choose the
  // import SOURCE: normally the live `config.json`, but on a DIRECT pre-W2.2 → W2.3
  // upgrade kolu-server's `1.31.0` strip-migration (backup-first) has ALREADY run
  // on its own boot — BEFORE padi's — so the live file has lost session/
  // activityFeed/lastPairedDaemon and the byte-exact pre-strip file sits beside it
  // as `config.json.pre-1.31-strip.bak`. That backup IS the intended source (the
  // last state kolu-server owned before shedding it), so a stripped live file
  // means we seed FROM the backup — migration logic picking its input at zero
  // loss, NOT a fallback: if the live file is stripped for any OTHER reason (no
  // strip-backup beside it) we take it as-is and the parse/empty path stays as it
  // was. The strip-backup is already durable, so it needs no `pre-padi-import` copy.
  const live = readConfigJson(oldPath);
  const stripBackupPath = `${oldPath}.pre-1.31-strip.bak`;
  const liveHasLegacy = IMPORTED_KEYS.some((key) => key in live);

  let raw = live;
  let sourcePath = oldPath;
  if (!liveHasLegacy && existsSync(stripBackupPath)) {
    raw = readConfigJson(stripBackupPath);
    sourcePath = stripBackupPath;
  } else {
    // The live file is the source — back it up ONCE, before seeding, so a wrong
    // whose-config-wins pick or a bad old blob is always recoverable.
    const backupPath = `${oldPath}.pre-padi-import.bak`;
    if (!existsSync(backupPath)) copyFileSync(oldPath, backupPath);
  }

  for (const key of IMPORTED_KEYS) {
    if (key in raw) {
      // The source was already migrated by kolu-server at its own boot, so the
      // blob arrives current-schema; seed padi's key verbatim.
      // biome-ignore lint/suspicious/noExplicitAny: seeding a raw current-schema blob key verbatim into the typed Conf; the old file's shape is validated by kolu-server's ladder, not re-parsed here.
      conf.set(key, raw[key] as any);
    }
  }
  conf.set("importedLegacyConfig", true);
  log.info(
    { sourcePath, keys: IMPORTED_KEYS },
    "imported legacy kolu config into padi's state-root (one-shot)",
  );
}
