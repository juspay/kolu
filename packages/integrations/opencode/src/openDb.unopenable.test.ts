import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-opencode-unopenable-"));
const blocked = path.join(dir, "blocked.sqlite");
fs.mkdirSync(blocked);
process.env.KOLU_OPENCODE_DB = blocked;

const { openDb } = await import("./core.ts");

describe("openDb — present but unopenable is a failed look", () => {
  it("throws instead of treating a directory-at-path as never-ran-here", () => {
    expect(() => openDb()).toThrow();
  });
});
