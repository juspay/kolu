/**
 * fleet-top-agent — serve the `top` surface over stdin/stdout.
 *
 * This is what `ssh <host> fleet-top-agent --stdio` runs on the far box. The
 * agent is ephemeral (a fresh one per link — `serveOverStdio` makes THIS
 * process be the server, and the framework exits the process once the awaited
 * serve settles: 0 on `'end'`, 1 on `'error'`); the parent's `makeSession`
 * re-spawns it on reconnect. That's the right shape for a re-run-fresh reader
 * like `top`.
 *
 * **Stdout is the protocol channel** — every diagnostic goes to fd 2. A stray
 * write to fd 1 corrupts the next frame.
 */

import { serveOverStdio } from "@kolu/surface/peer-server";
import { createTop } from "./top";

function log(line: string): void {
  process.stderr.write(`fleet-top-agent: ${line}\n`);
}

async function main(): Promise<void> {
  if (!process.argv.slice(2).includes("--stdio")) {
    process.stderr.write("usage: fleet-top-agent --stdio\n");
    process.exit(1);
  }
  const top = createTop();
  top.start();
  log(`serving top over stdio (pid ${process.pid})`);
  const end = await serveOverStdio({
    router: top.router,
    onFirstRequest: () => log("first RPC received — link is live"),
  });
  // Synchronous post-settle cleanup — the supported window before the
  // framework-owned exit (see `serveOverStdio`'s "Lifetime" doc).
  top.dispose();
  log(`stdin closed (${end.reason}) — agent exiting`);
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
