/**
 * Real-child-process fixture for the tenure pins (`tenure.test.ts`) — spawned
 * with `node --import tsx` (this package's internal imports carry `.ts`
 * extensions, but `@kolu/surface`'s do not, so plain
 * `--experimental-strip-types` cannot load the serve path).
 *
 * The fixture is a daemon *bin*: it serves an (uninvoked) router over a unix
 * socket under the private tmpdir passed as argv, while holding a live
 * `setInterval` — the stand-in for whatever RESOURCE OR TIMER the bin never
 * tied to the daemon's lifetime (kaval's node-pty children and served runtime
 * are the resource form; fleet-top's sampler interval is the loop-keeper form
 * — kaval/padi's own pollers are deliberately unref'd and are NOT the class).
 * Deliberately never cleared. Stage markers go to stderr (stdout stays
 * silent, as a real bin's would); the marker spellings and the sentinel exit
 * codes are single-sourced in `tenure.contract.testlib.ts`.
 *
 * Modes select the BIN SHAPE under test:
 *   --naive           what the docs taught before minus the homework line:
 *                     await the daemon, narrate, release — and forget
 *                     `process.exit`. The live interval then keeps the event
 *                     loop alive forever: the lingering-daemon red
 *                     (surface-lifetime-audit, drishti#109 at the daemon layer).
 *   --tenured         the cure: `daemonProcessMain` owns the exit.
 *   --already-running the gate is held by a live pid → exit 0 (success).
 *   --serve-failed    the socket path is unbindable → exit 1.
 *   --reject          the run thunk rejects → crash arm (narrate + exit 1).
 *   --throw           the run thunk throws synchronously → crash arm.
 *   --stderr-broken   `--reject` with a throwing stderr — the narration
 *                     failing must NOT prevent the exit (still 1).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonExit, DaemonSpec } from "./daemonMain.ts";
import { daemonMain } from "./daemonMain.ts";
import { stderrLogger } from "./logger.ts";
import { ESCAPE_EXIT, MARKER } from "./tenure.contract.testlib.ts";
import { daemonProcessMain } from "./tenure.ts";

const mode = process.argv[2];
const dirArg = process.argv[3];
if (dirArg === undefined) {
  process.stderr.write(
    "fixture: usage: tenure.fixture.testlib.ts <mode> <tmpdir>\n",
  );
  process.exit(2);
}
// A plain const so the narrowing survives into the closures below.
const dir: string = dirArg;

// Sentinel escape detectors, armed for EVERY mode before anything else runs:
// Node's default disposition for an escaped throw / unhandled rejection is
// ALSO exit code 1, which would make every `code === 1` pin vacuous (unable
// to tell a deliberate crash-arm exit from an escape). The sentinels turn
// either escape into a distinct code; they are inert in every healthy mode.
process.on("uncaughtException", () =>
  process.exit(ESCAPE_EXIT.uncaughtException),
);
process.on("unhandledRejection", () =>
  process.exit(ESCAPE_EXIT.unhandledRejection),
);

// The resource/timer stand-in: a live handle the bin never tied to the
// daemon's lifetime. Deliberately not unref'd and never cleared.
setInterval(() => {}, 1_000);

// The router is never invoked (no client dials the fixture) — only bound.
const router = {} as DaemonSpec["router"];

/** One full daemon run under the fixture's paths, narrating each stage. */
async function runDaemon(): Promise<DaemonExit> {
  const exit = await daemonMain({
    gatePath: join(dir, "gate.pid"),
    processIdentity: { pid: process.pid, startUnixUs: 1_000_000 },
    readProcessIdentity: (pid) =>
      pid === process.pid ? { pid, startUnixUs: 1_000_000 } : undefined,
    socketPath: join(dir, "daemon.sock"),
    router,
    // The fixture exercises tenure (exit ownership), not the anchor — honestly
    // unanchored, like any daemon with no on-disk identity.
    anchor: () => undefined,
    lifetime: { kind: "forever" },
    log: stderrLogger(),
    onReady: () => process.stderr.write(`${MARKER.listening}\n`),
  });
  process.stderr.write(`${MARKER.exitResolved(exit.kind)}\n`);
  // The bin's resource-release stage (fleet-top's `top.dispose()`,
  // kaval's `ptyHost.close()` — here just the marker).
  process.stderr.write(`${MARKER.releaseRan}\n`);
  return exit;
}

switch (mode) {
  case "--naive": {
    // The pre-cure bin shape minus its homework: no
    // `process.exit(daemonExitCode(exit))`. Nothing below ever runs it.
    void runDaemon();
    break;
  }
  case "--tenured": {
    daemonProcessMain({ name: "fixture-bin", run: runDaemon });
    break;
  }
  case "--already-running": {
    // A live holder (this very process) already owns the gate — the run
    // yields `already-running`, which is success (exit 0).
    writeFileSync(join(dir, "gate.pid"), `${process.pid}\t1000000\n`);
    daemonProcessMain({ name: "fixture-bin", run: runDaemon });
    break;
  }
  case "--serve-failed": {
    // A regular file squatting the socket path is never unlinked (it could
    // be user data), so the serve refuses → `serve-failed` → exit 1.
    writeFileSync(join(dir, "daemon.sock"), "not a socket\n");
    daemonProcessMain({ name: "fixture-bin", run: runDaemon });
    break;
  }
  case "--reject": {
    daemonProcessMain({
      name: "fixture-bin",
      run: () => Promise.reject(new Error("boom")),
    });
    break;
  }
  case "--throw": {
    daemonProcessMain({
      name: "fixture-bin",
      run: () => {
        throw new Error("sync boom");
      },
    });
    break;
  }
  case "--stderr-broken": {
    // The crash arm's narration write itself throws (a broken pipe on a dead
    // parent, forced): the exit must still happen — swallow-proof by pin.
    // The boot-time sentinels above are what make the pin non-vacuous: an
    // ESCAPED narration throw would exit with a sentinel code, so the test's
    // `code === 1` proves the guard delivered the exit.
    process.stderr.write = () => {
      throw new Error("stderr is gone");
    };
    daemonProcessMain({
      name: "fixture-bin",
      run: () => Promise.reject(new Error("boom")),
    });
    break;
  }
  default: {
    process.stderr.write(`fixture: unknown mode ${String(mode)}\n`);
    process.exit(2);
  }
}
