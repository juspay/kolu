/**
 * The daemon — part 1's `top`, now single-instance and durable.
 *
 * `daemonMain` is the whole `gate → serve → teardown` skeleton:
 *
 *   acquirePidGate(GATE_PATH)     — atomic single-instance claim (link(2)).
 *        │ held? → exit 0 (a live daemon already serves this scope)
 *        ▼
 *   serve { group, handlers }     — the @kolu/surface unix-socket listener
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
 * The same `createTop()` surface from part 1 is served verbatim — the daemon
 * changes how it's *reached* (a durable socket instead of a fresh
 * per-connection process), not what it serves. It hands the spine the SAME two
 * fields every transport takes: the flat `group` and the tag-keyed `handlers`.
 */

import {
  daemonMain,
  daemonProcessMain,
  stderrLogger,
} from "@kolu/surface-daemon";
import { HOME } from "../common/paths";
import {
  readProcessIdentity,
  selfProcessIdentity,
} from "../common/processIdentity";
import { createTop } from "./top";

daemonProcessMain({
  name: "fleet-top daemon",
  run: async () => {
    const top = createTop();

    // `finally`, not fulfilled-only: the release stage must run on the crash
    // arm too (a `top.start()` or `daemonMain` throw reaches
    // daemonProcessMain AFTER the sampler is disposed) — the same
    // wrapper-finally teardown ordering kaval and padi use. Everything after
    // `createTop()` sits inside the try so `top.dispose()` is structural.
    try {
      top.start();

      return await daemonMain({
        // gate, socket, anchor — all derived from home inside the spine
        home: HOME,
        processIdentity: selfProcessIdentity(),
        readProcessIdentity,
        group: top.runtime.group,
        handlers: top.runtime.handlers,
        lifetime: { kind: "forever" },
        log: stderrLogger(),
        onReady: ({ socketPath, pid }) =>
          process.stderr.write(
            `fleet-top daemon listening on ${socketPath} (pid ${pid})\n`,
          ),
      });
    } finally {
      top.dispose();
    }
  },
});
