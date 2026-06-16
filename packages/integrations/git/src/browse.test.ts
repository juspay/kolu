import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAll, readFile, readFileBytes, statFileMtimeMs } from "./browse.ts";

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

describe("readFileBytes (the binary-preview read)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-readbytes-test-"));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns raw bytes as base64, untruncated and undecoded", async () => {
    // A byte sequence that is NOT valid UTF-8 — the text `readFile` would
    // U+FFFD-mangle it; `readFileBytes` must round-trip it exactly.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    fs.writeFileSync(path.join(tmpDir, "image.png"), bytes);
    const result = await readFileBytes(tmpDir, "image.png");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.value.bytesBase64, "base64")).toEqual(bytes);
  });

  it("applies the same path-traversal guard as readFile", async () => {
    const result = await readFileBytes(tmpDir, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-readbytes-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.bin");
      fs.writeFileSync(secret, Buffer.from([0x00, 0x01]));
      fs.symlinkSync(secret, path.join(tmpDir, "leak.png"));
      const result = await readFileBytes(tmpDir, "leak.png");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("statFileMtimeMs", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-statmtime-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a symlink that escapes the repo root", async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "kolu-statmtime-outside-"),
    );
    try {
      const secret = path.join(outside, "secret.txt");
      fs.writeFileSync(secret, "TOP SECRET\n");
      fs.symlinkSync(secret, path.join(tmpDir, "leak.txt"));
      const result = await statFileMtimeMs(tmpDir, "leak.txt");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
