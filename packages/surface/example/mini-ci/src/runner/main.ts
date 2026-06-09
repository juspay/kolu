/**
 * mini-ci-runner entrypoint —
 * `mini-ci-runner --stdio [--pipeline ci.json] [--workspace DIR]`.
 *
 * Serves the pipeline surface over stdin/stdout. The default pipeline runs
 * real CI for the remote-process-monitor example, so tasks spawn with `cwd` =
 * the workspace root (auto-detected by walking up to `pnpm-workspace.yaml`,
 * or `--workspace` / `MINI_CI_WORKSPACE`). The `mini-ci-runner` nix closure
 * bundles that workspace, so the TUI can `nix copy` it to a remote host and
 * run this there over ssh — the drishti way, via `@kolu/surface-nix-host`'s
 * `HostSession`.
 *
 * **Stdout is the protocol channel** (lesson #4): all diagnostics go to
 * fd 2 via `log()`. `serveOverStdio` defensively redirects `console.log` to
 * stderr too, but this module avoids it for clarity.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { loadPipeline } from "../common/pipeline";
import { createRunner } from "./runner";

function log(...args: unknown[]): void {
  process.stderr.write(`${args.map((a) => String(a)).join(" ")}\n`);
}

/** Walk up from `start` until a directory holding `pnpm-workspace.yaml` —
 *  the root the closure bundles and the `pnpm --filter …` tasks run in. */
function findWorkspaceRoot(start: string): string {
  let dir = start;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "mini-ci-runner: workspace root (pnpm-workspace.yaml) not found",
      );
    }
    dir = parent;
  }
  return dir;
}

function usage(): never {
  process.stderr.write(
    [
      "mini-ci-runner — runs a task DAG and serves it as a @kolu/surface over stdio.",
      "",
      "Usage:",
      "  mini-ci-runner --stdio                     # serve over stdin/stdout",
      "  mini-ci-runner --stdio --pipeline ci.json  # load a custom pipeline",
      "  mini-ci-runner --stdio --workspace DIR     # run tasks in DIR",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      stdio: { type: "boolean" },
      pipeline: { type: "string" },
      workspace: { type: "string" },
    },
  });
  if (!values.stdio) usage();

  const spec = loadPipeline(values.pipeline);
  const cwd =
    values.workspace ??
    process.env.MINI_CI_WORKSPACE ??
    findWorkspaceRoot(fileURLToPath(new URL(".", import.meta.url)));

  const runner = createRunner(spec, { cwd });
  runner.start();
  log(
    `mini-ci-runner: pipeline "${spec.name}" (${spec.tasks.length} tasks) in ${cwd} — serving over stdio`,
  );

  const end = await serveOverStdio({
    router: runner.router,
    onFirstRequest: () => log("first RPC received — TUI attached"),
  });
  runner.dispose();
  log(`stdin closed (${end.reason}) — runner exiting`);
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
  process.exit(1);
});
