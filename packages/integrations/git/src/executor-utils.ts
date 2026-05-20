import path from "node:path";
import type { Executor } from "kolu-io";

export async function gitOutput(
  executor: Executor,
  cwd: string,
  args: string[],
  opts?: { allowExitCodes?: readonly number[]; maxBytes?: number },
): Promise<string> {
  const result = await executor.exec("git", args, {
    cwd,
    maxBytes: opts?.maxBytes,
  });
  const allowed = opts?.allowExitCodes ?? [0];
  if (result.exitCode !== null && allowed.includes(result.exitCode)) {
    return result.stdout;
  }
  throw new Error(
    result.stderr.trim() ||
      `git ${args.join(" ")} failed with exit code ${result.exitCode}`,
  );
}

export async function pathExists(
  executor: Executor,
  path: string,
): Promise<boolean> {
  try {
    await executor.statMtimeMs(path);
    return true;
  } catch {
    return false;
  }
}

export async function realpath(
  executor: Executor,
  target: string,
): Promise<string> {
  const result = await executor.exec("readlink", ["-f", target], {
    timeoutMs: 5_000,
  });
  return result.exitCode === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : target;
}

export async function resolveMainRepoRoot(
  executor: Executor,
  repoPath: string,
): Promise<string> {
  const gitCommonDir = (
    await gitOutput(executor, repoPath, ["rev-parse", "--git-common-dir"])
  ).trim();
  return path.dirname(
    await realpath(executor, path.resolve(repoPath, gitCommonDir)),
  );
}
