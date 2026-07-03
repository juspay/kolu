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
 *   - **the backup runs BEFORE the first read** — a byte copy to
 *     `config.json.pre-padi-import.bak`, once — so a wrong whose-config-wins pick
 *     (or a bad migration in the old file) stays recoverable. (This is the inline
 *     safeguard that replaced the standalone #1658 backup: a few lines, here.)
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

  const legacyStateDir = process.env.KOLU_STATE_DIR;
  if (!legacyStateDir) return; // a dev/e2e padi with its own fresh state-root

  const oldPath = join(legacyStateDir, "config.json");
  if (!existsSync(oldPath)) {
    // No legacy file to carry — mark done so we never re-scan, start from defaults.
    conf.set("importedLegacyConfig", true);
    return;
  }

  // The backup safeguard: a byte copy taken ONCE, BEFORE the first read, so a
  // wrong pick or a bad old blob is always recoverable.
  const backupPath = `${oldPath}.pre-padi-import.bak`;
  if (!existsSync(backupPath)) copyFileSync(oldPath, backupPath);

  // Take the file as-is, once. A parse failure THROWS (fail-fast) — padi crashes
  // rather than serving an empty session; the backup above is the recovery path.
  const raw = JSON.parse(readFileSync(oldPath, "utf8")) as Record<
    string,
    unknown
  >;
  for (const key of IMPORTED_KEYS) {
    if (key in raw) {
      // The old file was already migrated by kolu-server at its own boot, so the
      // blob arrives current-schema; seed padi's key verbatim.
      // biome-ignore lint/suspicious/noExplicitAny: seeding a raw current-schema blob key verbatim into the typed Conf; the old file's shape is validated by kolu-server's ladder, not re-parsed here.
      conf.set(key, raw[key] as any);
    }
  }
  conf.set("importedLegacyConfig", true);
  log.info(
    { oldPath, backupPath, keys: IMPORTED_KEYS },
    "imported legacy kolu config into padi's state-root (one-shot)",
  );
}
