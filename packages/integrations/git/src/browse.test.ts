import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listAll,
  listDirectory,
  listIgnored,
  readFile,
  filePreviewTag,
} from "./browse.ts";
import { _computeIgnore } from "./working-tree-watcher.ts";

describe("listAll", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listall-test-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    fs.mkdirSync(path.join(tmpDir, "People"));
    // git C-quotes non-ASCII paths (octal escapes, quote-wrapped) unless `-z`.
    fs.writeFileSync(path.join(tmpDir, "foo.md"), "plain\n");
    fs.writeFileSync(path.join(tmpDir, "People", "Amélie.md"), "bio\n");
    fs.writeFileSync(path.join(tmpDir, "メモ.txt"), "memo\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unicode paths verbatim — no C-quoting, no spurious folder", async () => {
    const result = await listAll(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value;
    expect(paths).toContain("People/Amélie.md");
    expect(paths).toContain("メモ.txt");
    expect(paths).toContain("foo.md");
    for (const p of paths) {
      expect(p).not.toContain('"');
      expect(p).not.toContain("\\3");
    }
  });
});

describe("listIgnored", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listignored-test-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "secret.log\nbuild/\n");
    fs.writeFileSync(path.join(tmpDir, "kept.md"), "kept\n");
    fs.writeFileSync(path.join(tmpDir, "secret.log"), "shh\n");
    fs.mkdirSync(path.join(tmpDir, "build"));
    fs.writeFileSync(path.join(tmpDir, "build", "out.js"), "artifact\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists ignored entries collapsed — a fully-ignored directory is ONE trailing-slash entry, never its contents", async () => {
    const result = await listIgnored(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain("secret.log");
    expect(result.value).toContain("build/");
    expect(result.value).not.toContain("build/out.js");
    expect(result.value).not.toContain("kept.md");
  });

  it("is the exact complement of listAll — disjoint, and together the whole tree", async () => {
    const all = await listAll(tmpDir);
    const ignored = await listIgnored(tmpDir);
    expect(all.ok && ignored.ok).toBe(true);
    if (!all.ok || !ignored.ok) return;
    expect(all.value).toContain("kept.md");
    expect(all.value).toContain(".gitignore");
    const tracked = new Set(all.value);
    expect(ignored.value.filter((p) => tracked.has(p))).toEqual([]);
    expect([...all.value, ...ignored.value].sort()).toEqual(
      [".gitignore", "build/", "kept.md", "secret.log"].sort(),
    );
  });

  it("feeds the watcher's parcel ignore as absolute, slash-free paths", async () => {
    const result = await _computeIgnore(tmpDir);
    if (!result.ok) throw new Error(`git could not list: ${result.error.code}`);
    const ignore = result.value;
    expect(ignore).toContain(path.join(tmpDir, "build"));
    expect(ignore).toContain(path.join(tmpDir, "secret.log"));
    expect(ignore).toContain(path.join(tmpDir, ".git"));
    for (const p of ignore) expect(p.endsWith("/")).toBe(false);
  });
});

describe("listDirectory", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listdir-test-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "out/\n");
    fs.mkdirSync(path.join(tmpDir, "out", "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "out", "index.html"), "<html>\n");
    fs.writeFileSync(path.join(tmpDir, "out", "style.css"), "body{}\n");
    fs.writeFileSync(path.join(tmpDir, "out", "assets", "logo.png"), "png\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads ONE level, marking subdirectories with git's trailing slash", async () => {
    const result = await listDirectory(tmpDir, "out/");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sort()).toEqual(
      ["out/assets/", "out/index.html", "out/style.css"].sort(),
    );
  });

  it("accepts the directory key with or without the trailing slash", async () => {
    const withSlash = await listDirectory(tmpDir, "out/");
    const without = await listDirectory(tmpDir, "out");
    expect(withSlash.ok && without.ok).toBe(true);
    if (!withSlash.ok || !without.ok) return;
    expect(without.value.sort()).toEqual(withSlash.value.sort());
  });

  it("needs no gitignore filtering — git only collapses a WHOLLY ignored dir", async () => {
    // git's `--directory` collapses a directory only when everything beneath
    // it is ignored.
    const ignored = await listIgnored(tmpDir);
    expect(ignored.ok).toBe(true);
    if (!ignored.ok) return;
    expect(ignored.value).toContain("out/");
    const children = await listDirectory(tmpDir, "out/");
    expect(children.ok).toBe(true);
    if (!children.ok) return;
    const tracked = await listAll(tmpDir);
    expect(tracked.ok).toBe(true);
    if (!tracked.ok) return;
    const trackedSet = new Set(tracked.value);
    expect(children.value.filter((p) => trackedSet.has(p))).toEqual([]);
  });

  it("refuses to escape the repo root", async () => {
    const result = await listDirectory(tmpDir, "../");
    expect(result.ok).toBe(false);
  });

  it("errors on a directory that is gone", async () => {
    const result = await listDirectory(tmpDir, "out/nope/");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_GONE");
  });

  it("follows a symlinked directory — pnpm's node_modules is mostly links", async () => {
    // `readdir({ withFileTypes: true })` has lstat semantics: a symlink reports
    // `isDirectory() === false`, and `fs.readFile` on it answers EISDIR.
    const linked = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listdir-link-"));
    try {
      fs.mkdirSync(path.join(linked, "real"), { recursive: true });
      fs.writeFileSync(path.join(linked, "real", "pkg.json"), "{}\n");
      fs.symlinkSync(
        path.join(linked, "real"),
        path.join(linked, "link-to-dir"),
      );
      fs.symlinkSync(
        path.join(linked, "gone"),
        path.join(linked, "link-broken"),
      );
      const result = await listDirectory(linked, "");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain("link-to-dir/");
      expect(result.value).toContain("link-broken");
    } finally {
      fs.rmSync(linked, { recursive: true, force: true });
    }
  });

  it("fails the listing when a symlink cannot be stat'd for a NON-gone reason", async () => {
    // ELOOP is the one stat failure reachable without root: a symlink cycle.
    const looped = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listdir-loop-"));
    try {
      fs.symlinkSync(path.join(looped, "b"), path.join(looped, "a"));
      fs.symlinkSync(path.join(looped, "a"), path.join(looped, "b"));
      const result = await listDirectory(looped, "");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("GIT_FAILED");
    } finally {
      fs.rmSync(looped, { recursive: true, force: true });
    }
  });
});

describe("readFile", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-readfile-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads file content", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "world\n");
    const result = await readFile(tmpDir, "hello.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe("world\n");
    expect(result.value.truncated).toBe(false);
  });

  it("rejects path traversal", async () => {
    const result = await readFile(tmpDir, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    }
  });

  it("returns error for non-existent file", async () => {
    const result = await readFile(tmpDir, "nope.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_GONE");
    }
  });

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-readfile-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "TOP SECRET\n");
      fs.symlinkSync(secret, path.join(tmpDir, "leak.txt"));
      const result = await readFile(tmpDir, "leak.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("follows a symlink that stays inside the repo", async () => {
    fs.writeFileSync(path.join(tmpDir, "target.txt"), "inside\n");
    fs.symlinkSync(
      path.join(tmpDir, "target.txt"),
      path.join(tmpDir, "alias.txt"),
    );
    const result = await readFile(tmpDir, "alias.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.content).toBe("inside\n");
  });
});

describe("filePreviewTag — preview cache-buster", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-contenttag-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("changes the tag when the file's bytes change", async () => {
    const p = path.join(tmpDir, "page.html");
    fs.writeFileSync(p, "<h1>before</h1>\n");
    const before = await filePreviewTag(tmpDir, "page.html");
    fs.writeFileSync(p, "<h1>after</h1>\n");
    const after = await filePreviewTag(tmpDir, "page.html");
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value).not.toBe(before.value);
  });

  it("hashes the WHOLE file — a tail-only edit past 32 MiB still moves the tag", async () => {
    const p = path.join(tmpDir, "big.html");
    const head = Buffer.alloc(40 * 1024 * 1024, 0x61);
    fs.writeFileSync(p, Buffer.concat([head, Buffer.from("<!-- tail A -->")]));
    const before = await filePreviewTag(tmpDir, "big.html");
    fs.writeFileSync(p, Buffer.concat([head, Buffer.from("<!-- tail B -->")]));
    const after = await filePreviewTag(tmpDir, "big.html");
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value).not.toBe(before.value);
  });

  it("keeps the tag STABLE when the file is rewritten with identical bytes (git checkout / atomic rewrite)", async () => {
    const p = path.join(tmpDir, "stable.html");
    const bytes = "<h1>unchanged</h1>\n";

    fs.writeFileSync(p, bytes);
    fs.utimesSync(
      p,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const first = await filePreviewTag(tmpDir, "stable.html");

    fs.writeFileSync(p, bytes);
    fs.utimesSync(
      p,
      new Date("2030-01-01T00:00:00Z"),
      new Date("2030-01-01T00:00:00Z"),
    );
    const reread = await readFile(tmpDir, "stable.html");
    expect(reread.ok).toBe(true);
    if (reread.ok) expect(reread.value.content).toBe(bytes);
    const second = await filePreviewTag(tmpDir, "stable.html");

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value).toBe(first.value);
  });

  it("aborts a superseded hash via the request signal instead of running to completion", async () => {
    const p = path.join(tmpDir, "abortable.bin");
    fs.writeFileSync(p, Buffer.alloc(4 * 1024 * 1024, 0x7));
    const ac = new AbortController();
    ac.abort();
    await expect(
      filePreviewTag(tmpDir, "abortable.bin", undefined, ac.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-contenttag-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "TOP SECRET\n");
      fs.symlinkSync(secret, path.join(tmpDir, "leak.txt"));
      const result = await filePreviewTag(tmpDir, "leak.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("tags a gone file FILE_GONE, not GIT_FAILED", async () => {
    const result = await filePreviewTag(tmpDir, "never-existed.bin");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FILE_GONE");
  });
});
