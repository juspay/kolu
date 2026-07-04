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

  it("SKIPS the import when padi already holds its OWN session — padi's state wins (never clobbered)", () => {
    // padi accrued its own session standalone (a workspace built with no legacy env,
    // which leaves the marker unset), and is only LATER bound WITH $KOLU_STATE_DIR.
    const stores = openPadiStateStores(stateRoot);
    stores.session.set({
      terminals: [{ id: "99999999-9999-9999-9999-999999999999" }],
      activeTerminalId: null,
      // biome-ignore lint/suspicious/noExplicitAny: a minimal SavedSession for the clobber-guard test.
    } as any);
    // A legacy file with a DIFFERENT session is present at bind time.
    writeLegacy(legacyBlob());

    importLegacyConfigOnce(stores, log);

    // padi's own session is UNTOUCHED — the shared config.json did not win.
    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "99999999-9999-9999-9999-999999999999",
    );
    // Marked done, so no later bind re-scans and clobbers.
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    // The skip happened BEFORE the read — no backup was taken.
    expect(existsSync(join(legacyDir, "config.json.pre-padi-import.bak"))).toBe(
      false,
    );
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

  it("DIRECT pre-W2.2 → W2.3 upgrade: imports from the strip-backup when the live file is already stripped — session intact, zero loss", () => {
    // The end-to-end direct-jump: kolu-server's `1.31.0` strip-migration ran FIRST
    // (on its own boot, before padi's), so the live `config.json` has already lost
    // session/activityFeed/lastPairedDaemon — only `preferences` survives — and the
    // byte-exact pre-strip file sits beside it as `config.json.pre-1.31-strip.bak`
    // (the SAME name kolu-server's strip writes, pinned by `stateMigration.test.ts`).
    // padi must seed from that backup, not the stripped live file.
    const oldPath = writeLegacy({
      preferences: {
        theme: "dark",
        newTerminalTheme: "x",
        shuffleBehavior: "y",
      },
    });
    writeFileSync(
      `${oldPath}.pre-1.31-strip.bak`,
      JSON.stringify(legacyBlob()),
    );

    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    // The session survived the direct jump — imported FROM the strip-backup.
    expect(stores.session.get()?.terminals).toHaveLength(1);
    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(stores.activityFeed.get().recentRepos).toEqual(["/repo/a"]);
    expect(stores.lastPairedDaemon.get()).toEqual({ startedAt: 1234 });
    expect(stores.conf.get("importedLegacyConfig")).toBe(true);
    // The strip-backup is already durable — no SECOND `pre-padi-import` copy.
    expect(existsSync(`${oldPath}.pre-padi-import.bak`)).toBe(false);
  });

  it("prefers the LIVE file when it still carries the keys, even if a strip-backup also exists", () => {
    // Defensive: the strip-backup is the source ONLY when the live file is stripped.
    // A live file that still has the session wins (the strip hasn't run yet), and it
    // takes its own `pre-padi-import` backup as usual.
    const oldPath = writeLegacy(legacyBlob());
    writeFileSync(
      `${oldPath}.pre-1.31-strip.bak`,
      JSON.stringify({
        ...legacyBlob(),
        session: {
          terminals: [{ id: "00000000-0000-0000-0000-000000000000" }],
          activeTerminalId: null,
        },
      }),
    );

    const stores = openPadiStateStores(stateRoot);
    importLegacyConfigOnce(stores, log);

    // The LIVE session won — not the backup's.
    expect(stores.session.get()?.terminals[0]?.id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(existsSync(`${oldPath}.pre-padi-import.bak`)).toBe(true);
  });
});
