import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMissingSqliteDb } from "./with-db.ts";

describe("isMissingSqliteDb", () => {
  it("treats a missing path's CANTOPEN as never-ran-here, not a failed look", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-sqlite-missing-"));
    const missing = join(dir, "no-such.sqlite");
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("nope"), { code: "ENOENT" }),
        missing,
      ),
    ).toBe(true);
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("unable to open database file"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 14,
        }),
        missing,
      ),
    ).toBe(true);
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("locked"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 5,
        }),
        missing,
      ),
    ).toBe(false);
  });

  it("a present file that fails to open is not absence", () => {
    const dir = mkdtempSync(join(tmpdir(), "kolu-sqlite-present-"));
    const present = join(dir, "exists.sqlite");
    writeFileSync(present, "");
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("unable to open database file"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 14,
        }),
        present,
      ),
    ).toBe(false);
    const asDir = join(dir, "blocked");
    mkdirSync(asDir);
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("unable to open database file"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 14,
        }),
        asDir,
      ),
    ).toBe(false);
  });
});
