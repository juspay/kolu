import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRealpathUnder,
  resolveExistingUnder,
  resolveForWriteUnder,
  resolveUnder,
} from "./safe-path.ts";

describe("resolveUnder (lexical)", () => {
  const root = "/tmp/some-repo";

  it("accepts a path inside the root", () => {
    const res = resolveUnder(root, "docs/output.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.abs).toBe(path.join(root, "docs/output.html"));
    expect(res.value.rel).toBe(path.join("docs", "output.html"));
  });

  it("rejects lexical traversal", () => {
    const res = resolveUnder(root, "../../etc/passwd");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("does NOT resolve symlinks — a symlink string still under root passes", () => {
    // The whole reason resolveExistingUnder exists: this lexical check is
    // blind to where `leak` actually points on disk.
    const res = resolveUnder(root, "leak");
    expect(res.ok).toBe(true);
  });
});

describe("resolveExistingUnder (lexical + symlink authority)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-safepath-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-safepath-outside-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("accepts a real file inside the root", async () => {
    fs.writeFileSync(path.join(root, "real.txt"), "x");
    const res = await resolveExistingUnder(root, "real.txt");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.abs).toBe(path.join(root, "real.txt"));
    expect(res.value.rel).toBe("real.txt");
  });

  it("follows a symlink that stays inside the root", async () => {
    fs.writeFileSync(path.join(root, "target.txt"), "x");
    fs.symlinkSync(path.join(root, "target.txt"), path.join(root, "alias.txt"));
    const res = await resolveExistingUnder(root, "alias.txt");
    expect(res.ok).toBe(true);
  });

  it("rejects a symlink that escapes the root (the finding)", async () => {
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET");
    fs.symlinkSync(secret, path.join(root, "leak.txt"));
    const res = await resolveExistingUnder(root, "leak.txt");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("rejects a path under an intermediate directory symlink that escapes", async () => {
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
    // `escape/` is a directory symlink pointing out of the repo; reading
    // `escape/secret.txt` must be rejected even though no `..` appears.
    fs.symlinkSync(outside, path.join(root, "escape"));
    const res = await resolveExistingUnder(root, "escape/secret.txt");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("rejects lexical traversal before touching the filesystem", async () => {
    const res = await resolveExistingUnder(root, "../../etc/passwd");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("passes a non-existent path through so the caller's fs op can 404/ENOENT", async () => {
    // No realpath target → no readable file to leak → not an escape.
    const res = await resolveExistingUnder(root, "does-not-exist.txt");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.abs).toBe(path.join(root, "does-not-exist.txt"));
  });
});

describe("resolveForWriteUnder (write-side authority)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-write-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-write-outside-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("accepts overwriting an existing file inside the root", async () => {
    fs.writeFileSync(path.join(root, "real.txt"), "x");
    const res = await resolveForWriteUnder(root, "real.txt");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.abs).toBe(path.join(root, "real.txt"));
    expect(res.value.rel).toBe("real.txt");
  });

  it("accepts creating a NEW file when the parent resolves under the root", async () => {
    // Unlike a read, a create-write targets a path that does not exist yet —
    // the guard must allow it as long as the parent directory is in-repo.
    const res = await resolveForWriteUnder(root, "new.md");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.abs).toBe(path.join(root, "new.md"));
  });

  it("accepts creating a new file in an existing nested dir", async () => {
    fs.mkdirSync(path.join(root, "docs"));
    const res = await resolveForWriteUnder(root, "docs/new.md");
    expect(res.ok).toBe(true);
  });

  it("rejects lexical traversal before touching the filesystem", async () => {
    const res = await resolveForWriteUnder(root, "../../etc/passwd");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("rejects a new leaf under an intermediate directory symlink that escapes (the finding)", async () => {
    // `escape/` is a directory symlink pointing out of the repo with a
    // non-existent leaf. resolveExistingUnder would fail OPEN here (realpath of
    // the missing leaf throws ENOENT) and let writeFile create the file
    // outside the root. resolveForWriteUnder realpaths the *parent* (the
    // symlink), sees it escapes, and rejects.
    fs.symlinkSync(outside, path.join(root, "escape"));
    const res = await resolveForWriteUnder(root, "escape/new.md");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("rejects when the parent directory does not exist (dangling write)", async () => {
    // No parent dir to resolve → the write would have to create out of
    // nowhere; reject rather than fail open.
    const res = await resolveForWriteUnder(root, "nope/new.md");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("resolves symlinks on the root too (symlinked checkout stays writable)", async () => {
    // A repo reached through a symlink (macOS /tmp -> /private/tmp) must not
    // make every legitimate write look like an escape.
    const rootLink = path.join(outside, "rootlink");
    fs.symlinkSync(root, rootLink);
    const res = await resolveForWriteUnder(rootLink, "new.md");
    expect(res.ok).toBe(true);
  });
});

describe("assertRealpathUnder", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-assert-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-assert-outside-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("accepts a real file inside the root", async () => {
    fs.writeFileSync(path.join(root, "real.txt"), "x");
    const res = await assertRealpathUnder(root, path.join(root, "real.txt"));
    expect(res.ok).toBe(true);
  });

  it("rejects an abs whose real path escapes via a symlink", async () => {
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET");
    fs.symlinkSync(secret, path.join(root, "leak.txt"));
    const res = await assertRealpathUnder(root, path.join(root, "leak.txt"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("passes through when the target does not exist", async () => {
    const res = await assertRealpathUnder(root, path.join(root, "nope.txt"));
    expect(res.ok).toBe(true);
  });

  it("resolves symlinks on the root too (symlinked checkout stays valid)", async () => {
    // `realpath(root)` matters: if we only realpath'd the target, a repo
    // reached through a symlink (macOS /tmp -> /private/tmp, a symlinked
    // checkout) would make every legitimate file look like an escape.
    fs.writeFileSync(path.join(root, "real.txt"), "x");
    const rootLink = path.join(outside, "rootlink");
    fs.symlinkSync(root, rootLink);
    const res = await assertRealpathUnder(
      rootLink,
      path.join(rootLink, "real.txt"),
    );
    expect(res.ok).toBe(true);
  });
});
