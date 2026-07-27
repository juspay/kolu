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

  it("fs.listAll returns tracked + untracked paths, and no ignored entries unless asked", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const { paths, ignoredPaths } = await f.listAll(repo);
    expect(paths).toContain("a.txt");
    expect(paths).toContain("untracked.txt");
    expect(ignoredPaths).toEqual([]);
  });

  it("fs.listAll enumerates collapsed gitignored entries when includeIgnored is set", async () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "secret.log\ndist/\n");
    fs.writeFileSync(path.join(repo, "secret.log"), "shh\n");
    fs.mkdirSync(path.join(repo, "dist"));
    fs.writeFileSync(path.join(repo, "dist", "out.js"), "artifact\n");
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const { paths, ignoredPaths } = await f.listAll(repo, true);
    expect(paths).toContain("a.txt");
    expect(paths).not.toContain("secret.log");
    // Collapsed: the fully-ignored directory is one trailing-slash entry.
    expect(ignoredPaths).toContain("secret.log");
    expect(ignoredPaths).toContain("dist/");
    expect(ignoredPaths).not.toContain("dist/out.js");
  });

  it("fs.readFile returns the working-tree content, untruncated", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    expect(await f.readFile(repo, "a.txt")).toEqual({
      content: "one\ntwo\n",
      truncated: false,
    });
  });

  it("fs.filePreviewTag returns a content hash that tracks bytes, not mtime", async () => {
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const tag = await f.filePreviewTag(repo, "a.txt");
    expect(tag).toMatch(/^[0-9a-f]{40}$/);
    // Touching the mtime without changing bytes leaves the tag stable.
    fs.utimesSync(
      path.join(repo, "a.txt"),
      new Date("2031-01-01T00:00:00Z"),
      new Date("2031-01-01T00:00:00Z"),
    );
    expect(await f.filePreviewTag(repo, "a.txt")).toBe(tag);
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
});
