/**
 * The tenure's last link — framework-owned process exit for a daemon *bin*.
 *
 * `daemonMain` deliberately never exits: it resolves a `DaemonExit` so the
 * whole lifecycle is drivable in-process from a test. That left the exit as
 * every bin's homework, and the surface-lifetime audit names the resulting
 * class (the drishti#109 shape at the daemon layer): any live resource or
 * timer the bin never tied to the daemon's lifetime — kaval's node-pty
 * children and served runtime, fleet-top's sampler interval — keeps the event
 * loop alive after the daemon's tenure ended, and the process lingers
 * invisibly. The partition:
 *
 *   - `daemonMain(spec)`  — the testable VALUE CORE. Resolves; never exits.
 *   - `daemonProcessMain` — "this process IS the daemon." Runs the daemon to
 *     completion, then exits with the classification that lives at the type's
 *     home (`daemonExitCode`); a rejection is narrated and exits `1`. No
 *     opt-out: a bin that adopts it cannot forget the exit or the crash arm,
 *     and the lingering-daemon state is unspellable.
 *
 * Sibling: `serveOverStdio`'s default-arm exit fork (`@kolu/surface`,
 * peer-server.ts "Lifetime") — the same cure at the link layer, aligned by
 * doctrine (let the settle cascade drain, exit on `setImmediate`, a caught
 * error must never block the exit) rather than by import: the dependency
 * arrow points surface-daemon → surface, so machinery here cannot be consumed
 * there, and the daemon vocabulary (`DaemonExit`) must not migrate into the
 * link-transport package.
 */
import { type DaemonExit, daemonExitCode } from "./daemonMain.ts";

/** The crash arm every bin used to hand-roll, made swallow-proof: the message
 *  is derived totally (a non-`Error` rejection has no `.message` to assume),
 *  and the narration itself is guarded — a failing stderr write (broken pipe
 *  on a dead parent) must not prevent the exit. `process.exit(1)` is
 *  UNCONDITIONAL. */
function crash(name: string, err: unknown): void {
  try {
    process.stderr.write(
      `${name}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  } catch {
    // Narration is best-effort; the exit below is the contract.
  }
  setImmediate(() => {
    process.exit(1);
  });
}

/** Run a daemon to completion and OWN the process exit — the bin entry point.
 *
 *  Call it as the bin's LAST statement: it returns synchronously (`void` —
 *  the function owns the rest of the process's life), so any code after it
 *  runs long before the eventual exit — legal, but almost never what the
 *  author meant. A legacy bin that still double-owns the exit (its own
 *  `.then(exit => process.exit(...))` map alongside) is a benign
 *  first-exit-wins race, not a crash — this PR's migrations remove the last
 *  such bins.
 *
 *  `run` is a thunk, not a promise, so a synchronous throw in the wrapper's
 *  setup (path resolution, store opening) lands in the crash arm instead of
 *  escaping the seam. The wrapper's own `finally` release stages (kaval's
 *  `ptyHost.close()`, padi's `served.close()`) are inside `run()`'s promise,
 *  so *stop accepting → release gate → release resources → exit* holds by
 *  construction — the exit cannot preempt a release stage.
 *
 *  `setImmediate` scheduling is shared doctrine with `serveOverStdio`'s exit
 *  fork: any continuation still attached to the wrapper's promise chain
 *  completes before the process dies. */
export function daemonProcessMain(opts: {
  /** Crash-arm narration prefix ("kaval", "padi"). */
  name: string;
  /** Run the daemon to completion — `daemonMain` or a wrapper around it. */
  run: () => Promise<DaemonExit>;
}): void {
  let settled: Promise<DaemonExit>;
  try {
    settled = opts.run();
  } catch (err) {
    crash(opts.name, err);
    return;
  }
  void settled.then(
    (exit) => {
      setImmediate(() => {
        process.exit(daemonExitCode(exit));
      });
    },
    (err: unknown) => {
      crash(opts.name, err);
    },
  );
}
