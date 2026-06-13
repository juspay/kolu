import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { waitForPidGone } from "./waitForPidGone.ts";

describe("waitForPidGone", () => {
  it("resolves true immediately for a pid that is already gone", async () => {
    // A pid we just reaped: spawn `true`, wait for exit, then probe.
    const child = spawn("true", { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise<void>((r) => child.on("exit", () => r()));
    expect(await waitForPidGone(pid, { timeoutMs: 1_000 })).toBe(true);
  });

  it("resolves true once a live process is killed", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid as number;
    const gonePromise = waitForPidGone(pid, {
      timeoutMs: 5_000,
      intervalMs: 10,
    });
    child.kill("SIGKILL");
    expect(await gonePromise).toBe(true);
  });

  it("resolves false when the process outlives the ceiling", async () => {
    // This very process is alive; a tiny ceiling must time out to false.
    expect(
      await waitForPidGone(process.pid, { timeoutMs: 60, intervalMs: 10 }),
    ).toBe(false);
  });
});
