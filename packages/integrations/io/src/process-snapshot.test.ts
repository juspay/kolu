import { spawn } from "node:child_process";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { describe, expect, it } from "vitest";
import { readProcessSnapshot } from "./process-snapshot.ts";

describe("readProcessSnapshot", () => {
  describeDaemon("reads a child's exec-time argv + env", () => {
    it("returns the launch env and argv", () => {
      if (process.platform !== "linux" && process.platform !== "darwin") return;
      const parkOnStdinUntilKilled = "process.stdin.resume()";
      const settingsArgWithWhitespace = '{"a": 1}';
      const child = spawn(
        process.execPath,
        [
          "-e",
          parkOnStdinUntilKilled,
          "--",
          "--settings",
          settingsArgWithWhitespace,
        ],
        { env: { ...process.env, KOLU_SNAPSHOT_MARKER: "present" } },
      );
      try {
        expect(child.pid).toBeDefined();
        const snap = readProcessSnapshot(child.pid!);
        expect(snap).not.toBeNull();
        expect(snap?.argv.slice(1)).toEqual([
          "-e",
          parkOnStdinUntilKilled,
          "--",
          "--settings",
          settingsArgWithWhitespace,
        ]);
        if (process.platform === "linux") {
          expect(snap?.env?.KOLU_SNAPSHOT_MARKER).toBe("present");
        } else {
          expect(snap?.env).toBeNull();
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
