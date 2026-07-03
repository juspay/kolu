/**
 * The one-shot legacy-config import — the cutover's whose-config-wins move.
 * Pins: the backup is taken BEFORE the first read; session/activityFeed/
 * lastPairedDaemon carry across but `preferences` never does; it runs EXACTLY
 * once; a malformed old file CRASHES loudly rather than starting empty; and with
 * no `$KOLU_STATE_DIR` it is a clean no-op (a dev/e2e padi with its own root).
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacyConfigOnce } from "./importLegacy.ts";
import { openPadiStateStores } from "./stateStore.ts";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SAVED_STATE_DIR = process.env.KOLU_STATE_DIR;
let legacyDir: string;
let stateRoot: string;

beforeEach(() => {
  legacyDir = mkdtempSync(join(tmpdir(), "padi-legacy-"));
  stateRoot = mkdtempSync(join(tmpdir(), "padi-sr-"));
  process.env.KOLU_STATE_DIR = legacyDir;
});
afterEach(() => {
  if (SAVED_STATE_DIR === undefined) delete process.env.KOLU_STATE_DIR;
  else process.env.KOLU_STATE_DIR = SAVED_STATE_DIR;
});

/** Write a legacy `config.json` under `$KOLU_STATE_DIR`. */
function writeLegacy(blob: unknown): string {
  const p = join(legacyDir, "config.json");
  writeFileSync(p, typeof blob === "string" ? blob : JSON.stringify(blob));
  return p;
}

const legacyBlob = () => ({
  session: {
    terminals: [{ id: "11111111-1111-1111-1111-111111111111" }],
    activeTerminalId: null,
  },
  activityFeed: { recentRepos: ["/repo/a"], recentAgents: ["claude"] },
  lastPairedDaemon: { startedAt: 1234 },
  // preferences must NOT cross into padi's store — it stays kolu-server's.
  preferences: { theme: "dark", newTerminalTheme: "x", shuffleBehavior: "y" },
});

describe("importLegacyConfigOnce", () => {
  it("carries session/activityFeed/lastPairedDaemon across, but NOT preferences", () => {
    writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.activityFeed.get().recentRepos).toEqual(["/repo/a"]);
    expect(stores.lastPairedDaemon.get()).toEqual({ startedAt: 1234 });
    // preferences is not a padi key at all — it never entered padi's store.
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(
      (stores.conf as unknown as { get(k: string): unknown }).get(
        "preferences",
      ),
    ).toBeUndefined();
  });

  it("takes the backup BEFORE reading — `config.json.pre-padi-import.bak`", () => {
    const oldPath = writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    const bak = `${oldPath}.pre-padi-import.bak`;
    expect(existsSync(bak)).toBe(true);
    // Byte-identical copy of the old file (the recovery artifact).
    expect(readFileSync(bak, "utf8")).toBe(readFileSync(oldPath, "utf8"));
  });

  it("imports EXACTLY once — a second call is a no-op even if the file changes", () => {
    writeLegacy(legacyBlob());
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.activityFeed.get().recentRepos).toEqual(["/repo/a"]);

    // The old file changes, but the marker blocks a re-import (padi owns its
    // state now — a re-import must never clobber padi's own later writes).
    writeLegacy({
      ...legacyBlob(),
      activityFeed: { recentRepos: ["/repo/b"], recentAgents: [] },
    });
    importLegacyConfigOnce(stores, log);
    expect(stores.activityFeed.get().recentRepos).toEqual(["/repo/a"]);
  });

  it("CRASHES loudly on a malformed old file — never starts empty", () => {
    writeLegacy("{ this is not valid json ");
    const stores = openPadiStateStores(stateRoot);
    expect(() => importLegacyConfigOnce(stores, log)).toThrow();
    // The marker is NOT set — a fixed file re-imports on the next boot.
    expect(stores.conf.get("importedLegacyConfig")).toBe(false);
  });

  it("is a clean no-op with no $KOLU_STATE_DIR (a dev/e2e padi with its own root)", () => {
    delete process.env.KOLU_STATE_DIR;
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.session.get()).toBeNull();
    // No legacy dir known → we do NOT mark imported (a later boot WITH the env can
    // still carry data across).
    expect(stores.conf.get("importedLegacyConfig")).toBe(false);
  });

  it("marks done (no re-scan) when $KOLU_STATE_DIR is set but no old file exists", () => {
    // legacyDir exists but has no config.json.
    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    expect(stores.session.get()).toBeNull();
  });
});
