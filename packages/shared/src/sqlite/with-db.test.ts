import { describe, expect, it } from "vitest";
import { isMissingSqliteDb } from "./with-db.ts";

describe("isMissingSqliteDb", () => {
  it("treats node:sqlite CANTOPEN as never-ran-here, not a failed look", () => {
    expect(
      isMissingSqliteDb(Object.assign(new Error("nope"), { code: "ENOENT" })),
    ).toBe(true);
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("unable to open database file"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 14,
        }),
      ),
    ).toBe(true);
    expect(
      isMissingSqliteDb(
        Object.assign(new Error("locked"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 5,
        }),
      ),
    ).toBe(false);
  });
});
