import { describe, it, expect, vi } from "vitest";
import { listDir } from "./list-dir.ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Logger } from "kolu-integration-common";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kolu-fs-test-"));
}

describe("listDir", () => {
  // ── Sorting ──

  it("lists files and directories sorted dirs-first, alphabetical", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "b.txt"), "");
    fs.writeFileSync(path.join(root, "a.txt"), "");
    fs.mkdirSync(path.join(root, "z-dir"));
    fs.mkdirSync(path.join(root, "a-dir"));

    const entries = await listDir({ path: root, root });

    expect(entries.map((e) => e.name)).toEqual([
      "a-dir",
      "z-dir",
      "a.txt",
      "b.txt",
    ]);
    expect(entries[0]!.isDirectory).toBe(true);
    expect(entries[2]!.isDirectory).toBe(false);
  });

  it("returns empty array for empty directory", async () => {
    const root = makeTmpDir();

    const entries = await listDir({ path: root, root });

    expect(entries).toEqual([]);
  });

  // ── Path resolution ──

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

  it("lists deeply nested relative path", async () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, "a", "b", "c"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c", "deep.txt"), "");

    const entries = await listDir({ path: "a/b/c", root });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("deep.txt");
  });

  it("allows listing the root itself", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "file.txt"), "");

    const entries = await listDir({ path: root, root });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("file.txt");
  });

  it("returns entries with full absolute paths", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "hello.txt"), "");

    const entries = await listDir({ path: root, root });

    expect(entries[0]!.path).toBe(path.join(root, "hello.txt"));
  });

  // ── Path traversal guard ──

  it("rejects .. traversal outside root", async () => {
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

  it("rejects sub/../.. traversal that escapes root", async () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, "sub"));

    await expect(listDir({ path: "sub/../..", root })).rejects.toThrow(
      "Path outside root",
    );
  });

  it("allows sub/.. that resolves back to root", async () => {
    const root = makeTmpDir();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "top.txt"), "");

    // sub/.. resolves to root — should be allowed
    const entries = await listDir({ path: "sub/..", root });

    expect(entries.map((e) => e.name)).toContain("top.txt");
  });

  it("rejects root prefix that is a sibling directory name", async () => {
    // e.g., root=/tmp/abc, path=/tmp/abcdef — starts with root string but is not under it
    const parent = makeTmpDir();
    const root = path.join(parent, "abc");
    const sibling = path.join(parent, "abcdef");
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);

    await expect(listDir({ path: sibling, root })).rejects.toThrow(
      "Path outside root",
    );
  });

  // ── Entry filtering ──

  it("includes dotfiles and hidden directories", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, ".env"), "");
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "visible.txt"), "");

    const entries = await listDir({ path: root, root });
    const names = entries.map((e) => e.name);

    expect(names).toContain(".env");
    expect(names).toContain(".git");
    expect(names).toContain("visible.txt");
  });

  it("excludes symlinks (readdir withFileTypes does not resolve them)", async () => {
    // TODO: Phase F or followup — resolve symlinks so they appear in the tree
    const root = makeTmpDir();
    const realDir = path.join(root, "real");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, path.join(root, "link"));
    fs.writeFileSync(path.join(root, "file.txt"), "");

    const entries = await listDir({ path: root, root });
    const names = entries.map((e) => e.name);

    // Symlink is filtered out (isFile and isDirectory are false for symlinks)
    expect(names).toContain("real");
    expect(names).toContain("file.txt");
    expect(names).not.toContain("link");
  });

  it("filters out non-file non-directory entries (sockets)", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "file.txt"), "");
    // Create a FIFO/named pipe if supported (Unix only)
    try {
      const { execSync } = await import("node:child_process");
      execSync(`mkfifo "${path.join(root, "pipe")}"`);
    } catch {
      // Skip on platforms without mkfifo — the filter still works, just can't test it
      return;
    }

    const entries = await listDir({ path: root, root });

    // Should only include the regular file, not the pipe
    expect(entries.map((e) => e.name)).toEqual(["file.txt"]);
  });

  // ── Error handling ──

  it("throws ENOENT for non-existent directory", async () => {
    const root = makeTmpDir();

    await expect(
      listDir({ path: path.join(root, "nope"), root }),
    ).rejects.toThrow(/ENOENT/);
  });

  it("throws ENOTDIR when path is a file, not a directory", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "file.txt"), "content");

    await expect(
      listDir({ path: path.join(root, "file.txt"), root }),
    ).rejects.toThrow(/ENOTDIR/);
  });

  // ── Logging ──

  it("calls logger.debug when log is provided", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "a.txt"), "");
    const log: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await listDir({ path: root, root, log });

    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenCalledWith(
      { path: root, count: 1 },
      "fs.listDir",
    );
  });

  it("does not throw when log is omitted", async () => {
    const root = makeTmpDir();
    fs.writeFileSync(path.join(root, "a.txt"), "");

    // Should not throw even without a logger
    await expect(listDir({ path: root, root })).resolves.toHaveLength(1);
  });
});
