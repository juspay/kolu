import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-opencode-missing-"));
process.env.KOLU_OPENCODE_DB = path.join(dir, "no-such-opencode.sqlite");

const { openDb } = await import("./core.ts");

describe("openDb — missing file is never-ran-here", () => {
  it("returns null instead of throwing ERR_SQLITE_ERROR", () => {
    expect(openDb()).toBeNull();
  });
});
