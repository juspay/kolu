/**
 * Diff review — powers the Code tab's Local and Branch modes.
 *
 * Two operations, each parameterized by a `mode`:
 *   - `getStatus(repoPath, mode)` → files changed for that mode.
 *   - `getDiff(repoPath, filePath, mode)` → raw unified-diff string for
 *     the file, plus the resolved old/new path names. Consumed by
 *     `@pierre/diffs`'s `parsePatchFiles` on the client.
 *
 * Modes:
 *   - `local`: working tree vs `HEAD`. Includes untracked files.
 *   - `branch`: working tree vs `merge-base(HEAD, origin/<default>)` —
 *     same answer a PR's "Files changed" tab gives, computed locally and
 *     forge-agnostically. Untracked files are excluded (they can't ship).
 *
 * All side-effects go through `GitExecutor` so the same code runs against
 * the controller's local fs (default) or against a remote host via
 * kolu-server's `Host`. The previous simple-git dependency was a
 * convenience wrapper around `child_process.execFile`; we now parse
 * `git status --porcelain=v1` directly to keep the local + remote paths
 * unified.
 */

import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { type GitExecutor, localExecutor } from "./executor.ts";
import { resolveUnder } from "./safe-path.ts";
import {
  type GitBaseRef,
  type GitChangedFile,
  type GitChangeStatus,
  GitChangeStatusSchema,
  type GitDiffMode,
  type GitDiffOutput,
  type GitStatusOutput,
} from "./schemas.ts";
import { detectDefaultBranch } from "./worktree.ts";

/** Coerce a raw porcelain / name-status letter into the typed enum,
 *  falling back to "?" for anything unexpected. */
function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = GitChangeStatusSchema.safeParse(letter);
  return parsed.success ? parsed.data : "?";
}

/** Run git via the executor; throw on missing-binary / signal kills,
 *  return stdout on exit-0, and tolerate `--no-index`-style exit-1
 *  (where stdout is the real payload). */
async function gitOutput(
  executor: GitExecutor,
  cwd: string,
  args: string[],
): Promise<string> {
  const result = await executor.exec("git", args, {
    cwd,
    maxBytes: 128 * 1024 * 1024,
  });
  if (result.exitCode === 0) return result.stdout;
  if (result.exitCode === 1 && result.stdout.length > 0) return result.stdout;
  throw new Error(result.stderr.trim() || `git exited ${result.exitCode}`);
}

/** Resolve the base ref for branch mode: `origin/<defaultBranch>` and the
 *  merge-base SHA between it and HEAD. */
async function resolveBase(
  executor: GitExecutor,
  repoPath: string,
): Promise<GitResult<GitBaseRef>> {
  const defaultBranch = await detectDefaultBranch(repoPath, executor);
  const ref = `origin/${defaultBranch}`;
  const verify = await executor.exec(
    "git",
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { cwd: repoPath },
  );
  if (verify.exitCode !== 0) {
    return err({
      code: "BASE_BRANCH_NOT_FOUND",
      ref,
      message:
        `No base branch found — ${ref} doesn't exist. ` +
        `Run: git fetch origin && git remote set-head origin --auto`,
    });
  }
  const sha = (
    await gitOutput(executor, repoPath, ["merge-base", "HEAD", ref])
  ).trim();
  return ok({ ref, sha });
}

/** Parse a single `git status --porcelain=v1 -z`-style entry into a
 *  changed-file record. Porcelain v1 format per line (NL-terminated):
 *
 *      XY <path>
 *      XY <new> -> <old>   (for renames/copies when used WITHOUT `-z`)
 *
 *  We use the newline form (`--porcelain=v1` without `-z`) for the
 *  prototype — renames remain detected because Y/X is `R` and the
 *  rename payload is `new -> old`. */
function parseStatusPorcelain(raw: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];
  for (const line of raw.split("\n")) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    // working_dir takes precedence; fall back to index. This matches the
    // pre-refactor behaviour of `getLocalStatus` (which used simple-git's
    // `working_dir !== " " ? working_dir : index`).
    const working = xy[1] ?? " ";
    const index = xy[0] ?? " ";
    const letter = working !== " " ? working : index;
    const arrowIdx = rest.indexOf(" -> ");
    if (arrowIdx !== -1) {
      const oldPath = rest.slice(0, arrowIdx);
      const newPath = rest.slice(arrowIdx + 4);
      files.push({
        path: newPath,
        status: toChangeStatus(letter),
        oldPath,
      });
    } else {
      files.push({ path: rest, status: toChangeStatus(letter) });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Parse `git diff --name-status <rev>` output into changed files. */
export function parseNameStatus(raw: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const letter = parts[0]?.[0] ?? "";
    const isRenameOrCopy = parts.length >= 3;
    const filePath = isRenameOrCopy ? parts[2] : parts[1];
    if (!filePath) continue;
    const status = toChangeStatus(letter);
    const oldPath = isRenameOrCopy ? parts[1] : undefined;
    files.push({ path: filePath, status, ...(oldPath && { oldPath }) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Working-tree status vs HEAD — the local-mode file list. Returns one
 *  entry per modified, added, deleted, renamed, copied, conflicted, or
 *  untracked file. Ignored files are excluded. */
async function getLocalStatus(
  executor: GitExecutor,
  repoPath: string,
): Promise<GitChangedFile[]> {
  const raw = await gitOutput(executor, repoPath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return parseStatusPorcelain(raw);
}

/** File list for `mode`. In `branch` mode the list comes from
 *  `git diff --name-status <merge-base>` — which naturally excludes
 *  untracked files. */
export async function getStatus(
  repoPath: string,
  mode: GitDiffMode,
  log?: Logger,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<GitStatusOutput>> {
  try {
    if (mode === "local") {
      return ok({
        files: await getLocalStatus(executor, repoPath),
        base: null,
      });
    }
    const baseResult = await resolveBase(executor, repoPath);
    if (!baseResult.ok) return baseResult;
    const raw = await gitOutput(executor, repoPath, [
      "diff",
      "--name-status",
      baseResult.value.sha,
    ]);
    return ok({ files: parseNameStatus(raw), base: baseResult.value });
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
    hasHunks: rawDiff.includes("\n@@"),
    oldAbsent: /^--- \/dev\/null/m.test(rawDiff),
    newAbsent: /^\+\+\+ \/dev\/null/m.test(rawDiff),
    binary: /^Binary files .* differ$/m.test(rawDiff),
  };
}

/** Compute the unified diff of one file for the given mode. */
export async function getDiff(
  repoPath: string,
  filePath: string,
  mode: GitDiffMode,
  log?: Logger,
  oldPath?: string,
  executor: GitExecutor = localExecutor,
): Promise<GitResult<GitDiffOutput>> {
  const pathResult = resolveUnder(repoPath, filePath, log);
  if (!pathResult.ok) return pathResult;
  const { abs, rel } = pathResult.value;

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
    const baseResult = await resolveBase(executor, repoPath);
    if (!baseResult.ok) return baseResult;
    baseRev = baseResult.value.sha;
  }

  try {
    const tracked = oldPath
      ? await gitOutput(executor, repoPath, [
          "diff",
          "-M",
          baseRev,
          "--",
          oldRel,
          rel,
        ])
      : await gitOutput(executor, repoPath, ["diff", baseRev, "--", rel]);

    const rawDiff =
      mode === "local" && tracked.trim().length === 0
        ? await gitOutput(executor, repoPath, [
            "diff",
            "--no-index",
            "--",
            "/dev/null",
            abs,
          ])
        : tracked;

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
