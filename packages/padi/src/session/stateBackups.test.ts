/**
 * padi's face of the ring: the list's session summary (the terminal count a
 * user ranks snapshots by, with `empty`/`unreadable` as distinct facts) and the
 * restore side's refusals. The happy restore path itself rides `importSession`
 * — covered by `sessionRestore.test.ts` and the serve tests — so it is not
 * re-driven here.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateBackupRing } from "kolu-shared/state-backup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { log } from "../log.ts";
import {
  listPadiStateBackups,
  restorePadiStateBackup,
} from "./stateBackups.ts";
import { padiConfigPath } from "./stateStore.ts";

let stateRoot: string;

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "padi-state-backups-"));
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

/** Write a state file with `content` and snapshot it into the ring. */
function seedSnapshot(content: string): string {
  writeFileSync(padiConfigPath(stateRoot), content);
  const outcome = openStateBackupRing(
    padiConfigPath(stateRoot),
    log,
  ).snapshot();
  if (outcome.kind !== "created") throw new Error("expected a snapshot");
  return outcome.file;
}

describe("listPadiStateBackups", () => {
  it("summarizes a session snapshot by its terminal count", () => {
    const file = seedSnapshot(
      JSON.stringify({
        session: { terminals: [{}, {}, {}], activeTerminalId: null },
      }),
    );
    const entry = listPadiStateBackups(stateRoot).backups.find(
      (b) => b.file === file,
    );
    expect(entry?.summary).toEqual({ kind: "session", terminals: 3 });
  });

  it("distinguishes an empty snapshot from an unreadable one", () => {
    const empty = seedSnapshot(JSON.stringify({ session: null }));
    const dir = join(stateRoot, "backups");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.1999-01-01T00-00-00-000Z.json"), "{nope");
    const backups = listPadiStateBackups(stateRoot).backups;
    expect(backups.find((b) => b.file === empty)?.summary).toEqual({
      kind: "empty",
    });
    expect(
      backups.find((b) => b.file === "config.1999-01-01T00-00-00-000Z.json")
        ?.summary,
    ).toEqual({ kind: "unreadable" });
  });
});

describe("restorePadiStateBackup", () => {
  it("refuses a snapshot with no session (fail-fast)", async () => {
    const file = seedSnapshot(JSON.stringify({ session: null }));
    await expect(restorePadiStateBackup(stateRoot, { file })).rejects.toThrow(
      /holds no session/,
    );
  });

  it("refuses a non-ring file name — traversal unspellable", async () => {
    await expect(
      restorePadiStateBackup(stateRoot, { file: "../config.json" }),
    ).rejects.toThrow(/not a state-backup file name/);
  });
});
