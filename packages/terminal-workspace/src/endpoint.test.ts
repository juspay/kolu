import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORPCError } from "@orpc/server";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminalWorkspaceEndpoint } from "./endpoint.ts";

const log = pino({ level: "silent" });

/** A temp git repo with one committed file, an uncommitted edit to it, and an
 *  untracked file — so listAll/getStatus/getDiff all have something to report. */
function mkTempRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-endpoint-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(repo, "untracked.txt"), "x\n");
  return repo;
}

describe("createTerminalWorkspaceEndpoint", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkTempRepo();
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
});
