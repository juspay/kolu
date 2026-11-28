import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOpenFileNames } from "./open-files.ts";

describe("readOpenFileNames", () => {
  it("names a file this process holds open, and drops it once closed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-open-files-"));
    const file = path.join(dir, "held.lock");
    fs.writeFileSync(file, "");
    const fd = fs.openSync(file, "r");
    try {
      const names = readOpenFileNames(process.pid);
      if (process.platform !== "linux") {
        // Unknown elsewhere — never an empty list.
        expect(names).toBeNull();
        return;
      }
      expect(names).toContain(fs.realpathSync(file));
    } finally {
      fs.closeSync(fd);
    }
    if (process.platform === "linux") {
      expect(readOpenFileNames(process.pid)).not.toContain(
        fs.realpathSync(file),
      );
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers null, not an empty list, for a pid that does not exist", () => {
    // Above the kernel's pid_max ceiling (2^22), so never a live pid.
    expect(readOpenFileNames(2 ** 22 + 1)).toBeNull();
  });
});
