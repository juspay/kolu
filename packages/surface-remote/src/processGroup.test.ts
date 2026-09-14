import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { spawnOwnedProcessGroup } from "./processGroup";

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForGroupExit(pgid: number): Promise<boolean> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    if (!groupAlive(pgid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !groupAlive(pgid);
}

describe.skipIf(process.platform === "win32")("owned process groups", () => {
  it("does not surface an unsignalable-group teardown race", () => {
    const transport = spawnOwnedProcessGroup("sleep", ["30"], {
      stdio: "ignore",
    });
    const pgid = transport.child.pid;
    expect(pgid).toBeTypeOf("number");
    if (pgid === undefined) return;

    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -pgid && signal === "SIGTERM") {
        throw Object.assign(new Error("operation not permitted"), {
          code: "EPERM",
        });
      }
      return true;
    });

    try {
      expect(() => transport.terminate()).not.toThrow();
      expect(kill).toHaveBeenCalledWith(-pgid, "SIGTERM");
    } finally {
      kill.mockRestore();
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        /* best-effort test cleanup */
      }
    }
  });

  it("teardown reaps an ssh ProxyCommand descendant instead of orphaning it", {
    timeout: 5_000,
  }, async () => {
    // No network is involved: ssh blocks on a ProxyCommand that is itself a
    // descendant. A direct `child.kill()` leaves `sleep` at PPID 1; group
    // teardown must remove both processes.
    const transport = spawnOwnedProcessGroup(
      "ssh",
      [
        "-F",
        "/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "ProxyCommand=sh -c 'sleep 30'",
        "unused.invalid",
        "true",
      ],
      { stdio: "ignore" },
    );
    const pgid = transport.child.pid;
    expect(pgid).toBeTypeOf("number");
    if (pgid === undefined) return;

    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const members = execFileSync("ps", ["-eo", "pgid=,args="], {
        encoding: "utf8",
      })
        .split("\n")
        .filter((line) => line.trimStart().startsWith(`${pgid} `));
      expect(members.some((line) => line.includes("sleep 30"))).toBe(true);

      transport.terminate();
      expect(await waitForGroupExit(pgid)).toBe(true);
    } finally {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        /* asserted gone */
      }
    }
  });
});
