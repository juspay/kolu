/**
 * Tenure pins for `daemonProcessMain` — a real child process per pin (the
 * function's whole job is `process.exit`, so an in-process assertion cannot
 * see the thing under test). The red these pin against: the `--naive` fixture
 * shape (await `daemonMain`, narrate, release — forget the exit homework)
 * lingers forever on a live resource/timer; `daemonProcessMain` makes that
 * state unspellable. Harness idioms shared with `@kolu/surface`'s
 * peer-server.lifetime.test.ts: single-buffer stderr watcher, 'close'-keyed
 * bounded exit wait, exact-handle teardown (never a pattern kill).
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, expect, it } from "vitest";
import { ESCAPE_EXIT, MARKER } from "./tenure.contract.testlib.ts";

// `.testlib.ts` is the repo's "test-only, never hashed" suffix — it keeps the
// spawnable fixture out of the daemon staleKeys (default.nix's fileFilter and
// the kaval/padi buildId closure tests all honor it).
const FIXTURE = fileURLToPath(
  new URL("./tenure.fixture.testlib.ts", import.meta.url),
);

/** A healthy framework exit is near-instant; 4s bounds it without flaking on
 *  a loaded box. */
const EXIT_WAIT_MS = 4_000;

const children: ChildProcessWithoutNullStreams[] = [];
const tmpDirs: string[] = [];
afterEach(() => {
  // Exact-handle teardown only: kill the PIDs we spawned, never a pattern.
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
  // And the per-child tmpdirs, so repeated runs don't silt up /tmp. Safe even
  // when the SIGKILL above hasn't reaped yet: a SIGKILLed child runs no
  // further code, and cleanly-exited children already finished their shutdown
  // unlinks (daemonMain's finally removes the socket and gate before resolving).
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function spawnBin(mode: string): ChildProcessWithoutNullStreams {
  assertDaemonSpawnAllowed("a real daemon bin (node --import tsx fixture)");
  const dir = mkdtempSync(join(tmpdir(), "tenure-pin-"));
  tmpDirs.push(dir);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", FIXTURE, mode, dir],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  return child;
}

/** One buffered stderr watcher per child (the peer-server lifetime pins'
 *  shape): a single 'data' listener + accumulator; `waitFor(marker)` rejects
 *  on 'close' if the marker never arrived. */
function watchStderr(child: ChildProcessWithoutNullStreams): {
  seen: () => string;
  waitFor: (marker: string) => Promise<void>;
} {
  let buf = "";
  const waiters: Array<{
    marker: string;
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];
  child.stderr.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w && buf.includes(w.marker)) {
        w.resolve();
        waiters.splice(i, 1);
      }
    }
  });
  child.once("close", () => {
    for (const w of waiters.splice(0)) {
      w.reject(
        new Error(`child closed before stderr marker "${w.marker}": ${buf}`),
      );
    }
  });
  return {
    seen: () => buf,
    waitFor: (marker) =>
      buf.includes(marker)
        ? Promise.resolve()
        : new Promise((resolve, reject) =>
            waiters.push({ marker, resolve, reject }),
          ),
  };
}

/** Await 'close' (exit AND stdio drained — the stderr assertions that follow
 *  must see the final flush), bounded; only the deadline is translated into
 *  the lingering-daemon diagnostic. */
async function waitExit(
  child: ChildProcessWithoutNullStreams,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  try {
    const [code, signal] = (await once(child, "close", {
      signal: AbortSignal.timeout(ms),
    })) as [number | null, NodeJS.Signals | null];
    return { code, signal };
  } catch (err) {
    if ((err as { code?: unknown }).code !== "ABORT_ERR") throw err;
    throw new Error(
      `child (pid ${child.pid}) did not exit within ${ms}ms — the lingering-daemon class (surface-lifetime-audit)`,
    );
  }
}

describeDaemon(
  "the naive bin shape — the red daemonProcessMain exists to kill",
  () => {
    it("lingers after its tenure ended: DaemonExit resolved, release ran, process still alive", async () => {
      // The red control for every pin below: it proves the fixture's live
      // interval REALLY holds the event loop (were it unref'd — or Node's
      // semantics to shift — the --tenured pin's "despite a live interval"
      // premise would be silently void and this test would fail first).
      const child = spawnBin("--naive");
      const stderr = watchStderr(child);
      await stderr.waitFor(MARKER.listening);

      child.kill("SIGTERM");
      await stderr.waitFor(MARKER.releaseRan);

      // The bin believes it is done — but nothing owns the exit, so the live
      // interval keeps the process alive past any healthy-exit horizon.
      let closed = false;
      child.once("close", () => {
        closed = true;
      });
      await delay(1_000);
      expect(closed).toBe(false);
      // afterEach reaps the immortal child by its exact handle.
    });
  },
);

describeDaemon("daemonProcessMain — the process IS the daemon", () => {
  it("exits 0 when the tenure ends (signal), despite a live interval — release stages strictly before the exit", async () => {
    const child = spawnBin("--tenured");
    const stderr = watchStderr(child);
    await stderr.waitFor(MARKER.listening);

    child.kill("SIGTERM");

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
    // Teardown order, observable: DaemonExit resolved, then the bin's release
    // stage, then the exit strictly after both ('close' guarantees the full
    // stderr flush, so marker presence == happened-before-exit).
    const seen = stderr.seen();
    const resolved = seen.indexOf(MARKER.exitResolved("shutdown"));
    const released = seen.indexOf(MARKER.releaseRan);
    expect(resolved).toBeGreaterThanOrEqual(0);
    expect(released).toBeGreaterThan(resolved);
  });

  it("exits 0 when another live daemon already holds the scope (already-running is success)", async () => {
    const child = spawnBin("--already-running");
    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
  });

  it("exits 1 when the daemon cannot serve (serve-failed)", async () => {
    const child = spawnBin("--serve-failed");
    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(1);
  });

  it("exits 1 and narrates when the run rejects (the crash arm no bin can forget)", async () => {
    const child = spawnBin("--reject");
    const stderr = watchStderr(child);
    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(1);
    expect(stderr.seen()).toContain("fixture-bin: boom");
  });

  it("exits 1 and narrates on a synchronous throw in the run thunk", async () => {
    const child = spawnBin("--throw");
    const stderr = watchStderr(child);
    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(1);
    expect(stderr.seen()).toContain("fixture-bin: sync boom");
  });

  it("still exits 1 when the crash narration itself throws (swallow-proof)", async () => {
    const child = spawnBin("--stderr-broken");
    const { code } = await waitExit(child, EXIT_WAIT_MS);
    // The fixture arms sentinel escape detectors (ESCAPE_EXIT), so 1 here
    // proves the guarded crash arm — not Node's default exit-1 disposition
    // for an escaped throw — delivered the exit.
    expect(code).toBe(1);
    expect(code).not.toBe(ESCAPE_EXIT.uncaughtException);
    expect(code).not.toBe(ESCAPE_EXIT.unhandledRejection);
  });
});
