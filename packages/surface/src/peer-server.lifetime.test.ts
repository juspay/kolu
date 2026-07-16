/**
 * Lifetime pins for `serveOverStdio` — the two arms of the construction-time
 * discriminant (Atlas: stdio-agent-lifetime; drishti#109).
 *
 * Default transport (the process IS the agent): a real child process serving
 * over its own stdio while holding a live `setInterval` must EXIT when the
 * parent closes the link — the framework owns the exit, so the immortal
 * orphan the field evidence documents is unspellable. Red on pre-fix code:
 * the child lives forever and the deadline assertion fails.
 *
 * The exit code discriminates HOW the link died: clean teardown exits 0 from
 * both directions — stdin EOF (read half) and a benign write EPIPE when the
 * parent's read side dies mid-push (the funnel branches on the codec's
 * `isBenignWriteError`, so the stdout-EPIPE-beats-stdin-EOF race can't flip
 * the code) — while a genuinely abnormal read error exits 1.
 *
 * Override transport (loopback/test/embedded peer): caller owns lifetime —
 * the promise resolves the value and the process does NOT exit.
 *
 * The child-process arm runs the sibling fixture with `node --import tsx`
 * (peer-server.ts uses extensionless internal imports, so plain
 * `--experimental-strip-types` cannot load it). Teardown kills only the
 * exact spawned handle — no pattern matching.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  setImmediate as macrotask,
  setTimeout as delay,
} from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLoopbackPair } from "./loopback";
import { stdioLink } from "./links/stdio";
import { serveOverStdio } from "./peer-server";
import type { lifetimeContract } from "./peer-server.lifetime.contract";

const FIXTURE = fileURLToPath(
  new URL("./peer-server.lifetime.fixture.ts", import.meta.url),
);

/** A healthy framework exit is near-instant; 4s bounds it without flaking on
 *  a loaded box. */
const EXIT_WAIT_MS = 4_000;

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  // Exact-handle teardown only: kill the PIDs we spawned, never a pattern.
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

function spawnAgent(...modeArgs: string[]): ChildProcessWithoutNullStreams {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", FIXTURE, ...modeArgs],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  children.push(child);
  return child;
}

/** Resolve when `marker` has appeared on the child's stderr. Rejects on
 *  'close' (all stdio drained — 'exit' can fire with stderr bytes still in
 *  the pipe) if the marker never arrived; pre-caught so an unawaited
 *  instance (used only via `seen()`) can never float an unhandled
 *  rejection, while awaiting callers still see the rejection through their
 *  own reference. */
function stderrMarker(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): { seen: () => string; until: Promise<void> } {
  let buf = "";
  const until = new Promise<void>((resolve, reject) => {
    child.stderr.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes(marker)) resolve();
    });
    child.once("close", () =>
      reject(
        new Error(`child closed before stderr marker "${marker}": ${buf}`),
      ),
    );
  });
  until.catch(() => {});
  return { seen: () => buf, until };
}

/** Await the child's 'close' (exit AND stdio drained — the stderr
 *  assertions that follow must see the final flush; 'exit' does not
 *  guarantee it), bounded by a deadline. Only the deadline is translated
 *  into the drishti#109 diagnostic; any other rejection (e.g. a spawn
 *  'error') surfaces as itself. */
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
      `child (pid ${child.pid}) did not exit within ${ms}ms — the immortal-orphan class (drishti#109)`,
    );
  }
}

describe("serveOverStdio lifetime — default transport (the process IS the agent)", () => {
  it("exits 0 when the parent closes the link, despite a live interval", async () => {
    const child = spawnAgent();
    const stderr = stderrMarker(child, "fixture: settled reason=end");
    await stderrMarker(child, "fixture: serving").until;

    child.stdin.end(); // parent death, read half: EOF on the agent's stdin

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
    // Post-settle sync work (step 4) ran before the framework exit.
    expect(stderr.seen()).toContain("fixture: settled reason=end");
  });

  it("exits 0 when the parent's read side dies mid-push (benign write EPIPE)", async () => {
    const child = spawnAgent();
    const stderr = stderrMarker(child, "fixture: settled reason=end");
    await stderrMarker(child, "fixture: serving").until;

    // Subscribe the forever-stream so the agent is continuously PUSHING,
    // then kill the parent's read side only: the agent's next push EPIPEs
    // while its stdin never sees EOF — clean teardown from the write
    // direction, which must exit 0 exactly like the EOF leg.
    const client = stdioLink<typeof lifetimeContract>({
      read: child.stdout,
      write: child.stdin,
    });
    const ticks = await client.tick();
    await ticks[Symbol.asyncIterator]().next(); // one yield roundtripped

    child.stdout.destroy(); // parent read side gone

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
    expect(stderr.seen()).toContain("fixture: settled reason=end");
  });

  it("exits 1 on a genuinely abnormal read-stream error", async () => {
    const child = spawnAgent("--self-error");
    await stderrMarker(child, "fixture: serving").until;

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(1);
  });
});

describe("serveOverStdio lifetime — explicit transport override (caller owns lifetime)", () => {
  it("resolves the end value and does NOT exit the process", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`process.exit(${code}) called on the override arm`);
    }) as never);
    try {
      const t = implement({ ping: oc.output(z.string()) });
      const router = t.router({ ping: t.ping.handler(() => "pong") });

      const pair = createLoopbackPair();
      const serving = serveOverStdio({ router, transport: pair.server });

      pair.client.write.end();
      pair.server.write.end();

      const end = await serving;
      expect(end.reason).toBe("end");

      // Drain past where the default arm schedules its exit fork
      // (setImmediate) — nothing may fire here. (Promisified setImmediate
      // resolves after the callback-form setImmediate the fork would use.)
      await macrotask();
      await delay(20);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
