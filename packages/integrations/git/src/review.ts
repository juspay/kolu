import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Result, Schema } from "effect";
import type { Logger } from "kolu-shared";
import type { SimpleGit } from "simple-git";
import { backgroundGit, backgroundGitEnv } from "./background.ts";
import { err, type GitResult, ok } from "./errors.ts";
import { resolveExistingUnder, resolveUnder } from "./safe-path.ts";
import {
  type GitBaseRef,
  type GitBranchStatus,
  type GitChangedFile,
  type GitChangeStatus,
  GitChangeStatusSchema,
  type GitDiffMode,
  type GitDiffOutput,
  type GitStatusOutput,
  type GitWorkingTreeSummary,
} from "./schemas.ts";
import { detectDefaultBranch } from "./worktree.ts";

const execFileP = promisify(execFile);

const decodeChangeStatus = Schema.decodeUnknownResult(GitChangeStatusSchema);

function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = decodeChangeStatus(letter);
  if (Result.isFailure(parsed)) {
    throw new Error(
      `git-review: unrecognized change-status letter ${JSON.stringify(letter)}`,
    );
  }
  return parsed.success;
}

async function hasOriginRemote(git: SimpleGit): Promise<boolean> {
  const remotes = (await git.raw(["remote"])).split("\n");
  return remotes.includes("origin");
}

async function resolveBase(
  repoPath: string,
): Promise<GitResult<GitBaseRef | null>> {
  const defaultBranch = await detectDefaultBranch(repoPath);
  const ref = `origin/${defaultBranch}`;
  const git = backgroundGit(repoPath);
  try {
    await git.raw(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    if (!(await hasOriginRemote(git))) return ok(null);
    return err({
      code: "BASE_BRANCH_NOT_FOUND",
      ref,
      message:
        `No base branch found — ${ref} doesn't exist. ` +
        `Run: git fetch origin && git remote set-head origin --auto`,
    });
  }
  const sha = (await git.raw(["merge-base", "HEAD", ref])).trim();
  return ok({ ref, sha });
}

/**
 * Parse `git diff --name-status -z <rev>` output into changed files.
 *
 * `-z` emits a flat NUL-separated token stream, never line/TAB text and never
 * C-quoted, so paths containing newlines, tabs, quotes, backslashes or
 * non-ASCII bytes round-trip verbatim. Each record is the status field
 * followed by its path(s): `<letter>\0<path>`, or `<R|C><score>\0<old>\0<new>`
 * for a rename/copy, where the NEW path is the one under review.
 */
export function parseNameStatus(raw: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];
  const tokens = raw.split("\0");
  let i = 0;
  while (i < tokens.length) {
    const field = tokens[i++];
    if (!field) continue; // skip the empty tail / stray separators
    const letter = field[0] ?? "";
    const status = toChangeStatus(letter);
    const isRenameOrCopy = letter === "R" || letter === "C";
    if (isRenameOrCopy) {
      const oldPath = tokens[i++];
      const filePath = tokens[i++];
      if (!filePath) continue;
      files.push({
        path: filePath,
        status,
        ...(oldPath && { oldPath }),
      });
    } else {
      const filePath = tokens[i++];
      if (!filePath) continue;
      files.push({ path: filePath, status });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** A porcelain status column carries a real change unless it's unmodified
 *  (" ") or untracked ("?") — the predicate the staged/modified counts share. */
function isTrackedChange(column: string): boolean {
  return column !== " " && column !== "?";
}

/**
 * Working-tree status vs HEAD — the whole `local`-mode result, read from a
 * single `git status` call: the file list (one entry per modified, added,
 * deleted, renamed, copied, conflicted, or untracked file; ignored files
 * excluded), the branch-tracking header, and the staged/modified/untracked
 * section counts. simple-git already parses all three off `git status
 * --porcelain --branch`; the latter two were discarded before R4.7.
 */
async function getLocalStatus(repoPath: string): Promise<{
  files: GitChangedFile[];
  branch: GitBranchStatus;
  workingTree: GitWorkingTreeSummary;
}> {
  const git = backgroundGit(repoPath);
  const status = await git.status();

  const seen = new Map<string, GitChangedFile>();
  for (const f of status.files) {
    const letter = f.working_dir !== " " ? f.working_dir : f.index;
    seen.set(f.path, {
      path: f.path,
      status: toChangeStatus(letter),
      ...(f.from && { oldPath: f.from }),
    });
  }
  for (const p of status.not_added) {
    if (!seen.has(p)) seen.set(p, { path: p, status: "?" });
  }

  // simple-git types `current` as `string | null` (its pre-parse default), but
  // `git status -b` always emits the `##` header — a null here means the header
  // did not parse at all.
  if (status.current === null) {
    throw new Error(
      "git-review: `git status -b` produced no branch header (status.current is null)",
    );
  }

  const branch: GitBranchStatus = {
    name: status.current,
    upstream: status.tracking,
    ahead: status.ahead,
    behind: status.behind,
  };
  const workingTree: GitWorkingTreeSummary = {
    staged: status.files.filter((f) => isTrackedChange(f.index)).length,
    modified: status.files.filter((f) => isTrackedChange(f.working_dir)).length,
    untracked: status.not_added.length,
  };

  return {
    files: [...seen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    branch,
    workingTree,
  };
}

/** File list for `mode`. In `branch` mode the list comes from
 *  `git diff --name-status <merge-base>`, which excludes untracked files. */
export async function getStatus(
  repoPath: string,
  mode: GitDiffMode,
  log?: Logger,
): Promise<GitResult<GitStatusOutput>> {
  try {
    if (mode === "local") {
      const { files, branch, workingTree } = await getLocalStatus(repoPath);
      return ok({ mode: "local", files, branch, workingTree });
    }
    const baseResult = await resolveBase(repoPath);
    if (!baseResult.ok) return baseResult;
    if (baseResult.value === null)
      return ok({ mode: "branch", files: [], base: null });
    const raw = await gitOutput(repoPath, [
      "diff",
      "--name-status",
      "-z",
      baseResult.value.sha,
    ]);
    return ok({
      mode: "branch",
      files: parseNameStatus(raw),
      base: baseResult.value,
    });
  } catch (e) {
    log?.error(
      { err: e instanceof Error ? e.message : String(e), repoPath, mode },
      "git-review: getStatus failed",
    );
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function parseRawDiffFlags(rawDiff: string): {
  hasHunks: boolean;
  oldAbsent: boolean;
  newAbsent: boolean;
  binary: boolean;
} {
  return {
    // A pure rename produces a header but no `@@` hunks.
    hasHunks: rawDiff.includes("\n@@"),
    oldAbsent: /^--- \/dev\/null/m.test(rawDiff),
    newAbsent: /^\+\+\+ \/dev\/null/m.test(rawDiff),
    binary: /^Binary files .* differ$/m.test(rawDiff),
  };
}

/**
 * Run git and return stdout, surviving the `--no-index` exit-1 convention:
 * `git diff --no-index` exits 1 when the two paths differ, which is its
 * success signal, not an error.
 */
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    // `-c core.quotePath=false` keeps unicode paths verbatim in the diff
    // headers; without it git C-quotes "unusual" bytes there.
    //
    // The four `diff.*` pins keep the headers on the `a/` / `b/` shape Pierre's
    // `parsePatchFiles` reads: a user's `diff.mnemonicPrefix`, `diff.noprefix`
    // or explicit `diff.srcPrefix`/`diff.dstPrefix` would otherwise leak into
    // them (#2317). The prefix keys are ignored by git < 2.45, where the two
    // `=false` pins already restore the defaults.
    const { stdout } = await execFileP(
      "git",
      [
        "-c",
        "core.quotePath=false",
        "-c",
        "diff.noprefix=false",
        "-c",
        "diff.mnemonicPrefix=false",
        "-c",
        "diff.srcPrefix=a/",
        "-c",
        "diff.dstPrefix=b/",
        ...args,
      ],
      {
        cwd,
        maxBuffer: 128 * 1024 * 1024,
        env: backgroundGitEnv(),
      },
    );
    return stdout;
  } catch (e) {
    // `execFile`'s rejection carries a numeric `code` plus `stdout`/`stderr`,
    // which `NodeJS.ErrnoException` types as `string`.
    const ex = e as { code?: number; stdout?: string };
    if (ex.code === 1 && typeof ex.stdout === "string") return ex.stdout;
    throw e;
  }
}

/**
 * Compute the unified diff of one file for the given mode. Local mode:
 * `git diff HEAD -- <file>`, falling back to `git diff --no-index /dev/null
 * <file>` for untracked files. Branch mode: `git diff <merge-base> -- <file>`.
 */
export async function getDiff(
  repoPath: string,
  filePath: string,
  mode: GitDiffMode,
  log?: Logger,
  oldPath?: string,
): Promise<GitResult<GitDiffOutput>> {
  const pathResult = resolveUnder(repoPath, filePath, log);
  if (!pathResult.ok) return pathResult;
  const { rel } = pathResult.value;

  let oldRel = rel;
  if (oldPath) {
    const oldPathResult = resolveUnder(repoPath, oldPath, log);
    if (!oldPathResult.ok) return oldPathResult;
    oldRel = oldPathResult.value.rel;
  }

  let baseRev: string;
  if (mode === "local") {
    baseRev = "HEAD";
  } else {
    const baseResult = await resolveBase(repoPath);
    if (!baseResult.ok) return baseResult;
    if (baseResult.value === null) {
      return ok({
        oldFileName: null,
        newFileName: null,
        hunks: [],
        binary: false,
      });
    }
    baseRev = baseResult.value.sha;
  }

  try {
    const tracked = oldPath
      ? await gitOutput(repoPath, ["diff", "-M", baseRev, "--", oldRel, rel])
      : await gitOutput(repoPath, ["diff", baseRev, "--", rel]);

    let rawDiff: string;
    if (mode === "local" && tracked.trim().length === 0) {
      const onDisk = await resolveExistingUnder(repoPath, filePath, log);
      if (!onDisk.ok) return onDisk;
      rawDiff = await gitOutput(repoPath, [
        "diff",
        "--no-index",
        "--",
        "/dev/null",
        onDisk.value.abs,
      ]);
    } else {
      rawDiff = tracked;
    }

    if (!rawDiff.trim().length) {
      log?.warn(
        { filePath: rel, mode },
        "git-review: empty diff for requested file",
      );
    }

    const flags = parseRawDiffFlags(rawDiff);

    return ok({
      oldFileName: flags.oldAbsent ? null : oldRel,
      newFileName: flags.newAbsent ? null : rel,
      hunks: rawDiff && flags.hasHunks ? [rawDiff] : [],
      binary: flags.binary,
    });
  } catch (e) {
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
