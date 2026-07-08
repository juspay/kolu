/**
 * The daemon — part 1's `top`, now single-instance and durable.
 *
 * `daemonMain` is the whole `gate → serve → teardown` skeleton:
 *
 *   acquirePidGate(GATE_PATH)     — atomic single-instance claim (link(2)).
 *        │ held? → exit 0 (a live daemon already serves this scope)
 *        ▼
 *   serve top.router over SOCKET  — the @kolu/surface unix-socket listener
 *        ▼
 *   wait for lifetime to end      — { kind: "forever" }: only a signal / abort
 *        ▼
 *   close socket · release gate · return DaemonExit
 *
 * We pick `forever` — an idle `top` still watches your machine, so an idle
 * timeout would wrongly kill it. `daemonMain` never calls `process.exit`; it
 * RETURNS a `DaemonExit` the bin maps to a code (`daemonExitCode`), which is
 * what makes the whole lifecycle drivable in-process from a test.
 *
 * The same flattened `createTop()` router from part 1 is served verbatim — the
 * daemon changes how it's *reached* (a durable socket instead of a fresh
 * per-connection process), not what it serves.
 */

import { daemonExitCode, daemonMain, stderrLogger } from "@kolu/surface-daemon";
import { GATE_PATH, SOCKET_PATH } from "../common/paths";
import { createTop } from "./top";

async function main(): Promise<void> {
  const top = createTop();
  top.start();

  const exit = await daemonMain({
    gatePath: GATE_PATH,
    socketPath: SOCKET_PATH,
    router: top.router,
    lifetime: { kind: "forever" },
    log: stderrLogger(),
    onReady: ({ socketPath, pid }) =>
      process.stderr.write(
        `fleet-top daemon listening on ${socketPath} (pid ${pid})\n`,
      ),
  });

  top.dispose();
  process.exit(daemonExitCode(exit));
}

main().catch((err) => {
  process.stderr.write(`daemon fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
