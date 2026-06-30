import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminalWorkspaceEndpoint } from "./endpoint.ts";
import { makeTempRepo } from "./gitRepo.testlib.ts";

const log = pino({ level: "silent" });

describe("createTerminalWorkspaceEndpoint", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("fs.listAll returns tracked + untracked paths", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const { paths } = await f.listAll(repo);
    expect(paths).toContain("a.txt");
    expect(paths).toContain("untracked.txt");
  });

  it("fs.readFile returns the working-tree content, untruncated", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    expect(await f.readFile(repo, "a.txt")).toEqual({
      content: "one\ntwo\n",
      truncated: false,
    });
  });

  it("fs.statFileMtimeMs returns a positive mtime", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    expect(await f.statFileMtimeMs(repo, "a.txt")).toBeGreaterThan(0);
  });

  it("git.getStatus reports the uncommitted change", async () => {
    const { git } = createTerminalWorkspaceEndpoint(log);
    const out = await git.getStatus(repo, "local");
    expect(out.files.some((file) => file.path === "a.txt")).toBe(true);
  });

  it("git.getDiff returns the changed hunk for a file", async () => {
    const { git } = createTerminalWorkspaceEndpoint(log);
    const out = await git.getDiff(repo, "a.txt", "local");
    expect(out.binary).toBe(false);
    expect(out.hunks.join("")).toContain("two");
  });

  it("fail-fast: a non-repo path THROWS an ORPCError, never resolves to empty", async () => {
    const { git } = createTerminalWorkspaceEndpoint(log);
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-notrepo-"));
    try {
      // The lifted `unwrapGit` must surface the git error, not swallow it into
      // an empty `{ files: [] }` — the no-fallbacks contract that moved with it.
      await expect(git.getStatus(notRepo, "local")).rejects.toBeInstanceOf(
        ORPCError,
      );
    } finally {
      fs.rmSync(notRepo, { recursive: true, force: true });
    }
  });

  // ── fs.previewRead — the range-capable byte read (R9.5 / PR-2) ──────────
  const decode = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

  it("fs.previewRead serves the whole file with a content-type, 200", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const r = await f.previewRead(repo, "a.txt", null);
    expect(r.status).toBe(200);
    expect(decode(r.bodyBase64)).toBe("one\ntwo\n");
    expect(r.headers["Content-Type"]).toContain("text/plain");
    expect(r.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("fs.previewRead honors a byte range — 206 + Content-Range", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    // a.txt is "one\ntwo\n" (8 bytes); bytes 0-2 are "one".
    const r = await f.previewRead(repo, "a.txt", "bytes=0-2");
    expect(r.status).toBe(206);
    expect(r.headers["Content-Range"]).toBe("bytes 0-2/8");
    expect(decode(r.bodyBase64)).toBe("one");
  });

  it("fs.previewRead rejects a repo-local symlink escaping the root — 403, no leak", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const secret = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-secret-"));
    const secretFile = path.join(secret, "secret.txt");
    fs.writeFileSync(secretFile, "SECRET");
    try {
      fs.symlinkSync(secretFile, path.join(repo, "leak.html"));
      const r = await f.previewRead(repo, "leak.html", null);
      expect(r.status).toBe(403);
      expect(decode(r.bodyBase64)).not.toContain("SECRET");
    } finally {
      fs.rmSync(secret, { recursive: true, force: true });
    }
  });

  it("fs.previewRead rejects a `..` traversal lexically — 400", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const r = await f.previewRead(repo, "../escape.txt", null);
    expect(r.status).toBe(400);
  });

  // ── fs.readTranscriptSource — guarded arbitrary-host-path read (R9.5) ────
  it("fs.readTranscriptSource reads the whole source under the store root", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-store-"));
    fs.writeFileSync(path.join(store, "session.jsonl"), '{"a":1}\n{"b":2}\n');
    try {
      expect(await f.readTranscriptSource(store, "session.jsonl")).toEqual({
        content: '{"a":1}\n{"b":2}\n',
      });
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });

  it("fs.readTranscriptSource fails fast on a `..` escape — ORPCError, never a leak", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const store = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-store-"));
    try {
      await expect(
        f.readTranscriptSource(store, "../../etc/passwd"),
      ).rejects.toBeInstanceOf(ORPCError);
    } finally {
      fs.rmSync(store, { recursive: true, force: true });
    }
  });
});
