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
import { fileURLToPath } from "node:url";
import { oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLoopbackPair } from "./loopback";
import { serveOverStdio } from "./peer-server";

const FIXTURE = fileURLToPath(
  new URL("./peer-server.lifetime.fixture.ts", import.meta.url),
);

/** Deadline pins: onEnd hard deadline is 2000ms; a healthy exit is near-
 *  instant. 4s bounds both without flaking on a loaded box. */
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

/** Resolve when `marker` has appeared on the child's stderr. */
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
    child.once("exit", () =>
      reject(
        new Error(`child exited before stderr marker "${marker}": ${buf}`),
      ),
    );
  });
  return { seen: () => buf, until };
}

function waitExit(
  child: ChildProcessWithoutNullStreams,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `child (pid ${child.pid}) did not exit within ${ms}ms — the immortal-orphan class (drishti#109)`,
        ),
      );
    }, ms);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe("serveOverStdio lifetime — default transport (the process IS the agent)", () => {
  it("exits 0 when the parent closes the link, despite a live interval", async () => {
    const child = spawnAgent();
    const stderr = stderrMarker(child, "fixture: settled reason=end");
    await stderrMarker(child, "fixture: serving").until;

    child.stdin.end(); // parent death: EOF on the agent's read stream

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
    // Post-settle sync work (step 4) ran before the framework exit.
    expect(stderr.seen()).toContain("fixture: settled reason=end");
  });

  it("exits 1 on a read-stream error", async () => {
    const child = spawnAgent("--self-error");
    await stderrMarker(child, "fixture: serving").until;

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(1);
  });

  it("a wedged onEnd cannot resurrect the orphan — hard deadline exits anyway", async () => {
    const child = spawnAgent("--wedged-on-end");
    await stderrMarker(child, "fixture: serving").until;

    child.stdin.end();

    const { code } = await waitExit(child, EXIT_WAIT_MS);
    expect(code).toBe(0);
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

      // Drain past where the default arm would schedule its exit fork
      // (setImmediate + the onEnd race) — nothing may fire here.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
