import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeInitFiles, writeInitFiles } from "./initFiles.ts";

function freshRcDir(): string {
  return mkdtempSync(join(tmpdir(), "kolu-initfiles-"));
}

describe("writeInitFiles / removeInitFiles", () => {
  it("writes flat + nested files, returns their paths, and reads back the content", () => {
    const rcDir = freshRcDir();
    const written = writeInitFiles(rcDir, [
      { name: "bashrc-T1", content: "export A=1" },
      { name: join("zdotdir-T2", ".zshrc"), content: "export B=2" },
    ]);
    const [flat, nested] = written;
    expect(written).toEqual([
      join(rcDir, "bashrc-T1"),
      join(rcDir, "zdotdir-T2", ".zshrc"),
    ]);
    expect(readFileSync(String(flat), "utf8")).toBe("export A=1");
    expect(readFileSync(String(nested), "utf8")).toBe("export B=2");
    expect(statSync(String(flat)).mode & 0o777).toBe(0o600);
  });

  it("REPLACES a stale leftover from a daemon that died without cleaning up", () => {
    const rcDir = freshRcDir();
    writeInitFiles(rcDir, [{ name: "bashrc-T1", content: "stale" }]);
    expect(
      writeInitFiles(rcDir, [{ name: "bashrc-T1", content: "replacement" }]),
    ).toEqual([join(rcDir, "bashrc-T1")]);
    expect(readFileSync(join(rcDir, "bashrc-T1"), "utf8")).toBe("replacement");
    expect(statSync(join(rcDir, "bashrc-T1")).mode & 0o777).toBe(0o600);
  });

  it("removes the files and prunes the empty parent dir it created, up to rcDir", () => {
    const rcDir = freshRcDir();
    const written = writeInitFiles(rcDir, [
      { name: join("zdotdir-T", ".zshrc"), content: "x" },
    ]);
    const [zshrc] = written;
    if (!zshrc) throw new Error("expected one written path");
    const zdotdir = dirname(zshrc);
    expect(existsSync(zdotdir)).toBe(true);
    removeInitFiles(rcDir, written);
    expect(existsSync(zshrc)).toBe(false);
    expect(existsSync(zdotdir)).toBe(false);
    expect(existsSync(rcDir)).toBe(true);
  });

  it("rejects a name that escapes rcDir (traversal / absolute) before writing anything", () => {
    const rcDir = freshRcDir();
    for (const bad of ["../escape", "../../etc/passwd", "/etc/passwd", "."]) {
      expect(() =>
        writeInitFiles(rcDir, [{ name: bad, content: "x" }]),
      ).toThrow(/escapes rcDir/);
    }
    expect(() =>
      writeInitFiles(rcDir, [
        { name: "ok", content: "x" },
        { name: "../bad", content: "y" },
      ]),
    ).toThrow(/escapes rcDir/);
    expect(existsSync(join(rcDir, "ok"))).toBe(false);
  });

  it("rolls back already-written files when a later write fails midway", () => {
    const rcDir = freshRcDir();
    writeInitFiles(rcDir, [{ name: "blocker", content: "x" }]);
    expect(() =>
      writeInitFiles(rcDir, [
        { name: "first", content: "1" },
        { name: join("blocker", "nested"), content: "2" },
      ]),
    ).toThrow();
    expect(existsSync(join(rcDir, "first"))).toBe(false);
    expect(existsSync(join(rcDir, "blocker"))).toBe(true);
  });
});
