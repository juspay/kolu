/**
 * mini-ci-runner entrypoint — `mini-ci-runner --stdio [--pipeline ci.json]`.
 *
 * Serves the pipeline surface over stdin/stdout. The TUI spawns this as a
 * child (local mode) or runs it on a remote host over `ssh` (remote mode);
 * both connect with the same `stdioLink`.
 *
 * **Stdout is the protocol channel** (lesson #4): all diagnostics go to
 * fd 2 via `log()`. `serveOverStdio` defensively redirects `console.log` to
 * stderr too, but this module avoids it for clarity.
 */

import { serveOverStdio } from "@kolu/surface/peer-server";
import { loadPipeline } from "../common/pipeline";
import { createRunner } from "./runner";

function log(...args: unknown[]): void {
  process.stderr.write(`${args.map((a) => String(a)).join(" ")}\n`);
}

function usage(): never {
  process.stderr.write(
    [
      "mini-ci-runner — runs a toy task DAG and serves it as a @kolu/surface over stdio.",
      "",
      "Usage:",
      "  mini-ci-runner --stdio                     # serve over stdin/stdout",
      "  mini-ci-runner --stdio --pipeline ci.json  # load a custom pipeline",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--stdio")) usage();

  const pipelineIdx = args.indexOf("--pipeline");
  const pipelinePath = pipelineIdx >= 0 ? args[pipelineIdx + 1] : undefined;
  const spec = loadPipeline(pipelinePath);

  const runner = createRunner(spec);
  runner.start();
  log(
    `mini-ci-runner: pipeline "${spec.name}" (${spec.tasks.length} tasks) — serving over stdio`,
  );

  await serveOverStdio({
    router: runner.router,
    onFirstRequest: () => log("first RPC received — TUI attached"),
  });
  runner.dispose();
  log("stdin closed — runner exiting");
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
  process.exit(1);
});
