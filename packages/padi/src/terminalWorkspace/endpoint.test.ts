import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FileGone,
  GitFailed,
  padiSurface,
  WorktreeBaseBranchMissing,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
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

  it("fs.listIgnored returns the collapsed gitignored complement of fs.listAll", async () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "secret.log\ndist/\n");
    fs.writeFileSync(path.join(repo, "secret.log"), "shh\n");
    fs.mkdirSync(path.join(repo, "dist"));
    fs.writeFileSync(path.join(repo, "dist", "out.js"), "artifact\n");
    const { fs: f } = createTerminalWorkspaceEndpoint(log);
    const { paths } = await f.listAll(repo);
    const { paths: ignored } = await f.listIgnored(repo);
    expect(paths).toContain("a.txt");
    expect(paths).not.toContain("secret.log");
    // Collapsed: the fully-ignored directory is one trailing-slash entry.
    expect(ignored).toContain("secret.log");
    expect(ignored).toContain("dist/");
    expect(ignored).not.toContain("dist/out.js");
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

  /** Delete-while-viewing must reach the wire as a TYPED `NOT_FOUND`, because
   *  that is the one status `BrowseFileDispatcher` swallows (matching the old
   *  value stream, which simply stopped yielding). Anything else is a visible
   *  error over a file the user merely deleted.
   *
   *  These pin the whole chain — `kolu-git` err → `unwrapGit` → the DECLARED
   *  `FileGone` — rather than any single link, because the regression they exist
   *  for lived precisely in the seam: `filePreviewTag` used to return
   *  `GIT_FAILED` for a gone file and rely on the errno text surviving into the
   *  thrown error's message. Once `isFileGoneError` was narrowed to treat a
   *  present `code` as authoritative, the wrapper's own generic failure answered
   *  first and the preserved message was never read. A unit test of the
   *  predicate alone cannot see that; only the assembled chain can. */
  describe("a gone file surfaces as the declared FileGone, through every read", () => {
    const tagOf = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
      } catch (e) {
        if (e instanceof FileGone || e instanceof GitFailed) return e._tag;
        throw e;
      }
      throw new Error("expected the read to reject");
    };

    it("fs.readFile", async () => {
      const { fs: f } = createTerminalWorkspaceEndpoint(log);
      expect(await tagOf(() => f.readFile(repo, "never-existed.txt"))).toBe(
        "FileGone",
      );
    });

    it("fs.filePreviewTag — the binary-preview path", async () => {
      const { fs: f } = createTerminalWorkspaceEndpoint(log);
      expect(
        await tagOf(() => f.filePreviewTag(repo, "never-existed.bin")),
      ).toBe("FileGone");
    });

    it("fs.listDirectory — a build output cleaned under an open row", async () => {
      const { fs: f } = createTerminalWorkspaceEndpoint(log);
      expect(await tagOf(() => f.listDirectory(repo, "never-existed"))).toBe(
        "FileGone",
      );
    });

    it("the gone PATH rides as DATA, so no reader re-parses the message", async () => {
      const { fs: f } = createTerminalWorkspaceEndpoint(log);
      await expect(f.readFile(repo, "never-existed.txt")).rejects.toMatchObject(
        {
          _tag: "FileGone",
          path: expect.stringContaining("never-existed.txt"),
        },
      );
    });
  });

  it("fail-fast: a non-repo path THROWS the declared GitFailed, never resolves to empty", async () => {
    const { git } = createTerminalWorkspaceEndpoint(log);
    const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-tw-notrepo-"));
    try {
      // The lifted `unwrapGit` must surface the git error, not swallow it into
      // an empty `{ files: [] }` — the no-fallbacks contract that moved with it.
      // It stays DECLARED (rather than becoming a defect) because the message is
      // what the user reads in the toast.
      await expect(git.getStatus(notRepo, "local")).rejects.toBeInstanceOf(
        GitFailed,
      );
    } finally {
      fs.rmSync(notRepo, { recursive: true, force: true });
    }
  });

  /** The handler-versus-declaration check `servePadi`'s `handle` cast skips:
   *  what these two reads RAISE for a Branch comparison with no fetched base
   *  must be what their members DECLARE, or the response encode fails and the
   *  Branch view shows "Failed to encode response" instead of the fix. */
  describe("an unfetched base branch surfaces as the declared WorktreeBaseBranchMissing", () => {
    beforeEach(() => {
      execFileSync(
        "git",
        [
          "remote",
          "add",
          "origin",
          "https://example.invalid/never-fetched.git",
        ],
        { cwd: repo, stdio: "pipe" },
      );
    });

    const declared = padiSurface.spec.procedures.git;
    const cases = [
      {
        member: "getStatus",
        read: () =>
          createTerminalWorkspaceEndpoint(log).git.getStatus(repo, "branch"),
        error: declared.getStatus.error,
      },
      {
        member: "getDiff",
        read: () =>
          createTerminalWorkspaceEndpoint(log).git.getDiff(
            repo,
            "a.txt",
            "branch",
          ),
        error: declared.getDiff.error,
      },
    ];
    it.each(cases)("git.$member", async ({ read, error }) => {
      const raised = await read().then(
        () => {
          throw new Error("expected the branch read to reject");
        },
        (e: unknown) => e,
      );
      expect(raised).toBeInstanceOf(WorktreeBaseBranchMissing);
      expect((raised as WorktreeBaseBranchMissing).message).toContain(
        "git fetch origin",
      );
      const schema = error as Schema.Codec<unknown, unknown>;
      expect(Schema.encodeUnknownSync(schema)(raised)).toMatchObject({
        _tag: "WorktreeBaseBranchMissing",
      });
    });
  });
});
