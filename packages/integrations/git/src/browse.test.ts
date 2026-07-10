import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAll, readFile, filePreviewTag } from "./browse.ts";

describe("listAll", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-listall-test-"));
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    fs.mkdirSync(path.join(tmpDir, "People"));
    // A plain file, a unicode (accented) file inside a folder, and a CJK
    // name — git C-quotes the latter two unless `-z` is passed.
    fs.writeFileSync(path.join(tmpDir, "foo.md"), "plain\n");
    fs.writeFileSync(path.join(tmpDir, "People", "Amélie.md"), "bio\n");
    fs.writeFileSync(path.join(tmpDir, "メモ.txt"), "memo\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns unicode paths verbatim — no C-quoting, no spurious folder", async () => {
    // The reported bug: without `-z`, git emits `"People/Am\303\251lie.md"`
    // (octal-escaped, double-quote-wrapped). The leading `"` became a
    // spurious `"People` folder and the leaf rendered as `Am\303\251lie.md"`.
    // With `-z` the path arrives intact and the tree builds correctly.
    const result = await listAll(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value;
    expect(paths).toContain("People/Amélie.md");
    expect(paths).toContain("メモ.txt");
    expect(paths).toContain("foo.md");
    // No entry should carry a wrapping quote or an octal escape.
    for (const p of paths) {
      expect(p).not.toContain('"');
      expect(p).not.toContain("\\3");
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
      expect(result.error.code).toBe("GIT_FAILED");
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
    // A large previewable HTML/PDF (a generated report) can exceed any prefix
    // cutoff. The tag must reflect the file's FULL content, not a leading slice:
    // an edit confined to the tail — same size, identical first 32 MiB — must
    // still move the tag, or a big scrollable preview would silently freeze on
    // stale bytes. Guards against a size-capped / leading-bytes-only shortcut.
    const p = path.join(tmpDir, "big.html");
    const head = Buffer.alloc(40 * 1024 * 1024, 0x61); // 40 MiB of 'a'
    fs.writeFileSync(p, Buffer.concat([head, Buffer.from("<!-- tail A -->")]));
    const before = await filePreviewTag(tmpDir, "big.html");
    fs.writeFileSync(p, Buffer.concat([head, Buffer.from("<!-- tail B -->")]));
    const after = await filePreviewTag(tmpDir, "big.html");
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value).not.toBe(before.value);
  });

  it("keeps the tag STABLE when the file is rewritten with identical bytes (git checkout / atomic rewrite)", async () => {
    // The reported regression: a preview scrolled to the middle reloads and
    // jumps to the top at "random" times while a remote terminal grinds a PR
    // loop. Cause: the iframe URL is cache-busted by mtime, and a `git checkout`
    // across branches — or a formatter's write-and-rename — rewrites the
    // working-tree file with the SAME bytes but a NEW mtime. The tag must track
    // the CONTENT, not the mtime: identical bytes ⇒ identical tag ⇒ no reload.
    const p = path.join(tmpDir, "stable.html");
    const bytes = "<h1>unchanged</h1>\n";

    // Two fixed, far-apart mtimes stand in for "the working tree was
    // re-materialized later" — deterministic, no reliance on wall-clock or
    // filesystem mtime resolution.
    fs.writeFileSync(p, bytes);
    fs.utimesSync(
      p,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-01-01T00:00:00Z"),
    );
    const first = await filePreviewTag(tmpDir, "stable.html");

    // Identical bytes, later mtime — exactly what a same-content checkout does.
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
    // Was RED against the old mtime-based tag; GREEN now the tag hashes content.
    expect(second.value).toBe(first.value);
  });

  it("aborts a superseded hash via the request signal instead of running to completion", async () => {
    // A superseded preview query (input changed, or a fresh file-change pulse
    // re-fired) aborts its request `signal`; the whole-file hash — costly on a
    // multi-GB video — must stop promptly, not run to completion. A pre-aborted
    // signal propagates the cancellation rather than collapsing to a GIT_FAILED
    // err the endpoint would re-throw opaquely.
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
});
