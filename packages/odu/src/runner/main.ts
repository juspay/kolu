/**
 * odu-runner entrypoint — the lane agent HostSession spawns on each host:
 *
 *   ssh <host> /nix/store/…-odu-runner/bin/odu-runner --stdio
 *
 * Stdout is the protocol channel: all diagnostics go to fd 2 (and
 * `serveOverStdio` defensively redirects `console.log` there). The runner
 * spawns idle and waits for `run.configure` over the surface; it exits when
 * the coordinator closes the pipe — one run per lane process.
 */

import { parseArgs } from "node:util";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { createLaneRunner } from "./runner";

const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      stdio: { type: "boolean" },
    },
  });
  if (values.stdio !== true) {
    log("usage: odu-runner --stdio   (spawned by the odu coordinator)");
    process.exit(1);
  }

  const runner = createLaneRunner();
  log("odu-runner: idle — waiting for run.configure over stdio");
  const end = await serveOverStdio({
    router: runner.router,
    onFirstRequest: () =>
      log("odu-runner: first RPC received — coordinator attached"),
  });
  runner.dispose();
  log(`odu-runner: stdin closed (${end.reason}) — exiting`);
}

main().catch((err: unknown) => {
  const e = err as Error;
  log(`odu-runner: fatal: ${e.message}\n${e.stack ?? ""}`);
  process.exit(1);
});
