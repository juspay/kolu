/**
 * The shipped TERM→KILL ladder against a child that cannot honour SIGTERM —
 * the #2178 field (TERM left every orphan up; KILL reaped them). `bash` +
 * `trap "" TERM` is the fixture, not a kaval daemon, so this stays in the
 * fork-free unit lane.
 */

import { spawn } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { killAfterGrace, reapUncooperative } from "./bindPidWatchdog.ts";
import { isHolderLive } from "./pidGate.ts";

const children: number[] = [];
afterEach(() => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

async function trapTermSleeper(): Promise<number> {
  const child = spawn("bash", ["-c", 'trap "" TERM; echo up; exec sleep 600'], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sleeper did not start");
  children.push(pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  return pid;
}

it("escalates to SIGKILL when the child ignores SIGTERM — and the process is gone", async () => {
  const pid = await trapTermSleeper();
  expect(isHolderLive(pid)).toBe(true);
  const ended = await reapUncooperative(pid, {
    termMs: 300,
    killMs: 2_000,
    intervalMs: 20,
  });
  expect(ended).toBe("SIGKILL");
  expect(isHolderLive(pid)).toBe(false);
});

it("killAfterGrace leaves a child that exits during the grace, SIGKILLs one that does not", async () => {
  const well = spawn("bash", ["-c", "echo up; exec sleep 600"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const wellPid = well.pid;
  if (wellPid === undefined)
    throw new Error("well-behaved sleeper did not start");
  children.push(wellPid);
  await new Promise<void>((resolve, reject) => {
    well.stdout.once("data", () => resolve());
    well.once("error", reject);
  });
  well.kill("SIGTERM");
  const wellEnded = await killAfterGrace(wellPid, {
    graceMs: 2_000,
    killMs: 2_000,
    intervalMs: 20,
  });
  expect(wellEnded).toBe("already-gone");
  expect(isHolderLive(wellPid)).toBe(false);

  const stuck = await trapTermSleeper();
  const stuckEnded = await killAfterGrace(stuck, {
    graceMs: 200,
    killMs: 2_000,
    intervalMs: 20,
  });
  expect(stuckEnded).toBe("SIGKILL");
  expect(isHolderLive(stuck)).toBe(false);
});

it("a well-behaved child ends at SIGTERM", async () => {
  const child = spawn("bash", ["-c", "echo up; exec sleep 600"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sleeper did not start");
  children.push(pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  const ended = await reapUncooperative(pid, {
    termMs: 2_000,
    killMs: 2_000,
    intervalMs: 20,
  });
  expect(ended).toBe("SIGTERM");
  expect(isHolderLive(pid)).toBe(false);
});
