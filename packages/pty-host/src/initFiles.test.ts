/**
 * The host's init-file materialisation — the only spawn-time job left after the
 * B0 inversion that isn't pure node-pty. Covers the round-trip (write → paths →
 * remove), nested names (zsh's `zdotdir-<id>/.zshrc`), empty-dir pruning, and
 * the containment guard that a name can't escape `rcDir`.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
    expect(existsSync(zdotdir)).toBe(false); // pruned
    expect(existsSync(rcDir)).toBe(true); // never pruned past rcDir
  });

  it("rejects a name that escapes rcDir (traversal / absolute) before writing anything", () => {
    const rcDir = freshRcDir();
    for (const bad of ["../escape", "../../etc/passwd", "/etc/passwd", "."]) {
      expect(() =>
        writeInitFiles(rcDir, [{ name: bad, content: "x" }]),
      ).toThrow(/escapes rcDir/);
    }
    // a legitimate sibling write alongside a bad one is not partially applied:
    // resolution happens before any write.
    expect(() =>
      writeInitFiles(rcDir, [
        { name: "ok", content: "x" },
        { name: "../bad", content: "y" },
      ]),
    ).toThrow(/escapes rcDir/);
    expect(existsSync(join(rcDir, "ok"))).toBe(false);
  });
});
