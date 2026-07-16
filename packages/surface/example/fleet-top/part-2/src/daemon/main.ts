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
 * RETURNS a `DaemonExit`, which is what makes the whole lifecycle drivable
 * in-process from a test. The BIN half — mapping that value to an exit code
 * and actually ending the process — belongs to `daemonProcessMain`: without
 * it, `top`'s live sampler interval would keep this process alive forever
 * after the daemon shut down (the lingering-daemon class).
 *
 * The same flattened `createTop()` router from part 1 is served verbatim — the
 * daemon changes how it's *reached* (a durable socket instead of a fresh
 * per-connection process), not what it serves.
 */

import {
  daemonMain,
  daemonProcessMain,
  stderrLogger,
} from "@kolu/surface-daemon";
import { GATE_PATH, SOCKET_PATH } from "../common/paths";
import { createTop } from "./top";

daemonProcessMain({
  name: "fleet-top daemon",
  run: async () => {
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

    // Release resources BEFORE returning: the exit runs strictly after.
    top.dispose();
    return exit;
  },
});
