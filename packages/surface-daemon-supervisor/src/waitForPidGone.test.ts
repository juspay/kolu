import { spawn } from "node:child_process";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { waitForPidGone } from "./waitForPidGone.ts";

describeDaemon("waitForPidGone", () => {
  it("succeeds true immediately for a pid that is already gone", async () => {
    // A pid we just reaped: spawn `true`, wait for exit, then probe.
    const child = spawn("true", { stdio: "ignore" });
    const pid = child.pid as number;
    await new Promise<void>((r) => child.on("exit", () => r()));
    expect(
      await Effect.runPromise(waitForPidGone(pid, { timeoutMs: 1_000 })),
    ).toBe(true);
  });

  it("succeeds true once a live process is killed", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    const pid = child.pid as number;
    // `runPromise` runs the fiber on THIS stack until it suspends, so the first
    // liveness probe has already happened before the kill below — the same
    // ordering the eager Promise version had.
    const gone = Effect.runPromise(
      waitForPidGone(pid, { timeoutMs: 5_000, intervalMs: 10 }),
    );
    child.kill("SIGKILL");
    expect(await gone).toBe(true);
  });

  it("succeeds false when the process outlives the ceiling", async () => {
    // This very process is alive; a tiny ceiling must time out to false.
    expect(
      await Effect.runPromise(
        waitForPidGone(process.pid, { timeoutMs: 60, intervalMs: 10 }),
      ),
    ).toBe(false);
  });
});
