import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { err, type GitResult, ok } from "./errors.ts";

const execFileAsync = promisify(execFile);

export const WATCHER_DEBOUNCE_MS = 150;

export const GIT_QUERY_TIMEOUT_MS = 5_000;

/** Every git query a watcher install waits on goes through here: a child
 *  process off the event loop, bounded by {@link GIT_QUERY_TIMEOUT_MS}. */
async function boundedGitQuery(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf-8",
    timeout: GIT_QUERY_TIMEOUT_MS,
  });
  return stdout.trim();
}

/** `git rev-parse` reports a relative path from the repo root but a
 *  realpath-resolved absolute path from a subdir, so the answer is
 *  canonicalized before it keys the shared-watcher registry. */
async function revParseDir(cwd: string, flag: string): Promise<string | null> {
  try {
    const answer = await boundedGitQuery(cwd, ["rev-parse", flag]);
    return await fs.promises.realpath(path.resolve(cwd, answer));
  } catch {
    return null;
  }
}

export function resolveGitDir(cwd: string): Promise<string | null> {
  return revParseDir(cwd, "--git-dir");
}

export function resolveGitCommonDir(cwd: string): Promise<string | null> {
  return revParseDir(cwd, "--git-common-dir");
}

export async function isInsideWorkTree(
  cwd: string,
): Promise<GitResult<boolean>> {
  let answer: string;
  try {
    answer = await boundedGitQuery(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({
      code: "GIT_FAILED",
      message: `Failed to tell whether the root has a working tree: ${msg}`,
    });
  }
  if (answer === "true") return ok(true);
  if (answer === "false") return ok(false);
  return err({
    code: "GIT_FAILED",
    message: `git rev-parse --is-inside-work-tree answered ${JSON.stringify(answer)}`,
  });
}
