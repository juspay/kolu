/**
 * The #1658 acceptance cases, pinned: boot with an existing state file → backup
 * created; boot again unchanged → no new backup (byte-dedupe); ring past N →
 * oldest pruned; backup-write failure → the call answers `failed` and throws
 * nothing (fail-soft — the one sanctioned deviation from fail-fast, see the
 * module doc). Plus the restore side's fail-FAST: a wire-crossing file name
 * that is not a ring member's is refused (path traversal unspellable).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listStateBackups,
  readStateBackup,
  snapshotStateFile,
  STATE_BACKUP_RING_SIZE,
  stateBackupDir,
} from "./stateBackup.ts";

let dir: string;
let configPath: string;
const logged: { level: "info" | "error"; msg: string }[] = [];
const log = {
  info: (_obj: object, msg: string) => logged.push({ level: "info", msg }),
  error: (_obj: object, msg: string) => logged.push({ level: "error", msg }),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "state-backup-"));
  configPath = join(dir, "config.json");
  logged.length = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshotStateFile", () => {
  it("skips a fresh install (no state file, no ring dir)", () => {
    expect(snapshotStateFile(configPath, log)).toEqual({
      kind: "no-state-file",
    });
    expect(listStateBackups(configPath)).toEqual([]);
  });

  it("copies an existing state file into the ring, byte-identical", () => {
    writeFileSync(configPath, '{"session":{"terminals":[1]}}');
    const outcome = snapshotStateFile(configPath, log);
    expect(outcome.kind).toBe("created");
    const [entry] = listStateBackups(configPath);
    expect(entry).toBeDefined();
    expect(
      readFileSync(join(stateBackupDir(configPath), entry!.file), "utf8"),
    ).toBe('{"session":{"terminals":[1]}}');
  });

  it("dedupes an unchanged file — a quick restart churns no copy", () => {
    writeFileSync(configPath, '{"a":1}');
    expect(snapshotStateFile(configPath, log).kind).toBe("created");
    expect(snapshotStateFile(configPath, log)).toEqual({ kind: "unchanged" });
    expect(listStateBackups(configPath)).toHaveLength(1);
  });

  it("snapshots again once the content changes, newest first", () => {
    writeFileSync(configPath, '{"a":1}');
    snapshotStateFile(configPath, log);
    writeFileSync(configPath, '{"a":2}');
    const outcome = snapshotStateFile(configPath, log);
    expect(outcome.kind).toBe("created");
    const entries = listStateBackups(configPath);
    expect(entries).toHaveLength(2);
    expect(
      readFileSync(
        join(stateBackupDir(configPath), entries[0]!.file),
        "utf8",
      ),
    ).toBe('{"a":2}');
  });

  it(`prunes the ring to the newest ${STATE_BACKUP_RING_SIZE}`, () => {
    for (let i = 0; i < STATE_BACKUP_RING_SIZE + 3; i += 1) {
      writeFileSync(configPath, `{"i":${i}}`);
      expect(snapshotStateFile(configPath, log).kind).toBe("created");
    }
    const entries = listStateBackups(configPath);
    expect(entries).toHaveLength(STATE_BACKUP_RING_SIZE);
    // The newest survives; the oldest three were pruned.
    expect(
      readFileSync(
        join(stateBackupDir(configPath), entries[0]!.file),
        "utf8",
      ),
    ).toBe(`{"i":${STATE_BACKUP_RING_SIZE + 2}}`);
  });

  it("fail-soft: an unwritable ring dir logs and answers failed, never throws", () => {
    writeFileSync(configPath, '{"a":1}');
    // Occupy the ring dir's name with a FILE so mkdir/copy must fail.
    writeFileSync(stateBackupDir(configPath), "not a directory");
    expect(snapshotStateFile(configPath, log)).toEqual({ kind: "failed" });
    expect(logged.some((l) => l.level === "error")).toBe(true);
  });
});

describe("readStateBackup", () => {
  it("round-trips a snapshot's JSON", () => {
    writeFileSync(configPath, '{"session":null,"n":42}');
    const outcome = snapshotStateFile(configPath, log);
    if (outcome.kind !== "created") throw new Error("expected a snapshot");
    expect(readStateBackup(configPath, outcome.file)).toEqual({
      session: null,
      n: 42,
    });
  });

  it("refuses a non-ring file name — traversal is unspellable", () => {
    expect(() => readStateBackup(configPath, "../config.json")).toThrow(
      /not a state-backup file name/,
    );
    expect(() => readStateBackup(configPath, "pwn.json")).toThrow(
      /not a state-backup file name/,
    );
  });

  it("throws on a missing snapshot (fail-fast on the restore side)", () => {
    expect(() =>
      readStateBackup(configPath, "config.2026-01-01T00-00-00-000Z.json"),
    ).toThrow();
  });
});
