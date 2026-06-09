/**
 * `odu protect` — PATCH GitHub branch-protection's required_status_checks to
 * the (recipe × platform) contexts the canonical DAG produces, justci's
 * `protect` equivalent. `--dry-run` prints the contexts without touching the
 * API. The bookkeeping `_ci-setup@<platform>` context is posted but never
 * required, matching the protection list observed under justci.
 */

import { spawnSync } from "node:child_process";
import { loadHosts, resolveLanes } from "../coordinator/hosts";
import { parseGithubRemote } from "../coordinator/statuses";
import { loadJustPipeline } from "../just/ingest";

export interface ProtectArgs {
  dryRun: boolean;
  branch?: string;
  platforms: string[];
}

export async function protectCommand(args: ProtectArgs): Promise<number> {
  const repoRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).stdout.trim();
  const spec = loadJustPipeline(repoRoot);
  const lanes = resolveLanes(loadHosts(), [], args.platforms);
  const platforms = Object.keys(lanes).sort();
  if (platforms.length === 0) {
    process.stderr.write(
      "odu: no platforms configured (hosts file is empty)\n",
    );
    return 1;
  }
  const contexts = platforms.flatMap((platform) =>
    spec.tasks.map((task) => `${task.id}@${platform}`),
  );

  if (args.dryRun) {
    for (const context of contexts) process.stdout.write(`${context}\n`);
    return 0;
  }

  const origin = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).stdout.trim();
  const github = parseGithubRemote(origin);
  if (github === null) {
    process.stderr.write("odu: protect needs a github.com origin remote\n");
    return 1;
  }
  const branch =
    args.branch ??
    spawnSync(
      "gh",
      [
        "api",
        `repos/${github.owner}/${github.repo}`,
        "--jq",
        ".default_branch",
      ],
      { encoding: "utf-8" },
    ).stdout.trim();

  const body = JSON.stringify({
    strict: false,
    contexts,
  });
  const result = spawnSync(
    process.env.ODU_GH_BIN ?? "gh",
    [
      "api",
      "--method",
      "PATCH",
      `repos/${github.owner}/${github.repo}/branches/${branch}/protection/required_status_checks`,
      "--input",
      "-",
    ],
    { input: body, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    process.stderr.write(`odu: protect PATCH failed:\n${result.stderr}`);
    return 1;
  }
  process.stdout.write(
    `odu: required_status_checks on ${branch} set to ${contexts.length} contexts\n`,
  );
  return 0;
}
