/**
 * Process-exit pins for `makeSession`'s timers (the surface-lifetime audit's
 * abandoned-session finding; design: docs/atlas session-timer-unref).
 *
 * Event-loop holding is invisible from inside a vitest worker (the runner
 * itself keeps the loop alive), so both pins spawn a REAL node child running a
 * fixture under tsx's in-process ESM loader (the `kaval` `socketDaemon.test.ts`
 * shape) and assert on the child's actual exit:
 *
 *  1. IMMORTALIZATION (red-first): an abandoned session — pinned, never
 *     destroyed, against a never-connecting endpoint — must not keep its host
 *     process alive once the main script ends. Pre-fix the ref'd
 *     reconnect-backoff timer pinned the loop forever; post-fix the process
 *     exits promptly (the fixture's backoff delay is far LONGER than the exit
 *     deadline, so a clean exit can only mean the timer didn't hold the loop).
 *
 *  2. MUST-FIRE (guarantee preservation): `withHandshakeTimeout`'s timer is
 *     deliberately NOT unref'd — its firing rejects a promise `pin()`
 *     propagates to an awaiting caller, and a pending await holds no handle of
 *     its own. The fixture makes that timer the process's ONLY handle; the pin
 *     is that the rejection still REACHES the awaiter (elapsed ≥ the timeout,
 *     marker printed) instead of the process exiting silently at 0ms — and
 *     that the process then exits (the backoff armed after the failure is
 *     unref'd: the exit window).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// tsx's ESM loader, resolved from THIS package's node_modules — `node --import
// <loader> fixture.ts` runs the TypeScript fixture as a real child without a
// hoisted .bin/tsx symlink (pnpm doesn't hoist it to the repo root).
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const here = dirname(fileURLToPath(import.meta.url));

interface FixtureRun {
  timedOut: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

/** Spawn `fixture` as a real node child and wait for it to exit, up to
 *  `deadlineMs`. On deadline the child is SIGKILLed (it was immortal — the
 *  red this suite exists to pin) and `timedOut: true` is returned; assertions
 *  on it fail loud instead of hanging the suite. */
function runFixture(fixture: string, deadlineMs: number): Promise<FixtureRun> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", TSX_LOADER, join(here, fixture)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, deadlineMs);
    child.on("error", (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      resolve({
        // SIGKILL from the deadline killer above ⇒ the child outlived the
        // deadline (a self-exiting child never sees it).
        timedOut: signal === "SIGKILL",
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

describe("makeSession timers vs the host process's life", () => {
  it("an abandoned session (pinned, undestroyed, endpoint gone) does not immortalize its host process", {
    timeout: 20_000,
  }, async () => {
    // Deadline (8s) ≪ the fixture's reconnectDelayMs (30s): a clean exit
    // within it proves the pending backoff timer held nothing — it cannot be
    // "the timer fired and the loop drained".
    const run = await runFixture("processExit.fixture.immortal.ts", 8_000);
    expect(run.stdout).toContain("MAIN-END");
    expect(
      run.timedOut,
      `child still alive after 8s — its session timers hold the event loop (stderr: ${run.stderr})`,
    ).toBe(false);
    expect(run.code).toBe(0);
  });

  it("a caller awaiting pin() still receives the admit-handshake timeout when its timer is the only handle", {
    timeout: 20_000,
  }, async () => {
    const run = await runFixture("processExit.fixture.handshake.ts", 10_000);
    // The rejection was DELIVERED — not a silent early exit: the marker
    // carries withHandshakeTimeout's own message, and the child lived at
    // least the 1.5s timeout it took to fire.
    expect(run.stdout).toContain(
      "HANDSHAKE-REJECTED: admit handshake timed out",
    );
    expect(run.elapsedMs).toBeGreaterThanOrEqual(1_500);
    expect(
      run.timedOut,
      `child still alive after 10s (stderr: ${run.stderr})`,
    ).toBe(false);
    expect(run.code).toBe(0);
  });
});
