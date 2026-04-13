import { describe, it, expect } from "vitest";
import { listDir } from "./list-dir.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kolu-fs-test-"));
}

describe("listDir", () => {
  it("lists files and directories sorted dirs-first", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "b.txt"), "");
    fs.writeFileSync(path.join(root, "a.txt"), "");
    fs.mkdirSync(path.join(root, "z-dir"));
    fs.mkdirSync(path.join(root, "a-dir"));

    const entries = await listDir({ path: root, root });

    // Directories first, alphabetical within each group.
    expect(entries.map((e) => e.name)).toEqual([
      "a-dir",
      "z-dir",
      "a.txt",
      "b.txt",
    ]);
    expect(entries[0]!.isDirectory).toBe(true);
    expect(entries[2]!.isDirectory).toBe(false);
  });

  it("lists subdirectory when path is relative to root", async () => {
    const root = makeTmpDir();
    const sub = path.join(root, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "file.txt"), "");

    const entries = await listDir({ path: "sub", root });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("file.txt");
    expect(entries[0]!.path).toBe(path.join(sub, "file.txt"));
  });

  it("rejects path traversal outside root", async () => {
    const root = makeTmpDir();

    await expect(listDir({ path: "..", root })).rejects.toThrow(
      "Path outside root",
    );
  });

  it("rejects absolute path outside root", async () => {
    const root = makeTmpDir();

    await expect(listDir({ path: "/tmp", root })).rejects.toThrow(
      "Path outside root",
    );
  });

  it("allows listing the root itself", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "file.txt"), "");

    const entries = await listDir({ path: root, root });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("file.txt");
  });

  it("returns entries with full paths", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "hello.txt"), "");

    const entries = await listDir({ path: root, root });

    expect(entries[0]!.path).toBe(path.join(root, "hello.txt"));
  });
});
