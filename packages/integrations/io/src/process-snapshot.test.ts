import { spawn } from "node:child_process";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { describe, expect, it } from "vitest";
import { readProcessSnapshot } from "./process-snapshot.ts";

describe("readProcessSnapshot", () => {
  describeDaemon("reads a child's exec-time argv + env", () => {
    // NOTE: /proc/<pid>/environ reflects the EXEC-TIME env only (a setenv
    // after start does not reach it) — which is also exactly the launch env
    // an agent integration needs. Tests therefore spawn a child carrying the
    // marker rather than mutating this process's own env. (describeDaemon-
    // gated: the child is a real fork, so this case runs only where forks are
    // allowed.)
    it("returns the launch env and argv", () => {
      if (process.platform !== "linux" && process.platform !== "darwin") return;
      // The child parks on stdin rather than on a timer: it must stay alive
      // for the parent's /proc read, and `process.stdin.resume()` holds the
      // event loop open without binding the test to any duration.
      const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], {
        env: { ...process.env, KOLU_SNAPSHOT_MARKER: "present" },
      });
      try {
        expect(child.pid).toBeDefined();
        const snap = readProcessSnapshot(child.pid!);
        expect(snap).not.toBeNull();
        expect(snap?.argv.length).toBeGreaterThan(0);
        if (process.platform === "linux") {
          expect(snap?.env.KOLU_SNAPSHOT_MARKER).toBe("present");
        } else {
          // Darwin: macOS redacts even same-user environment maps from ps
          // — env is {} by OS policy (documented in process-snapshot.ts).
          expect(snap?.env.KOLU_SNAPSHOT_MARKER).toBeUndefined();
        }
      } finally {
        child.kill();
      }
    });
  });

  it("returns null for a pid that does not exist", () => {
    expect(readProcessSnapshot(2 ** 22)).toBeNull();
  });
});
