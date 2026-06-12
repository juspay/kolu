import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePidGate,
  pidGatePathForSocket,
  pidIsAlive,
  readPidGate,
} from "./pidGate.ts";

const tmpDirs: string[] = [];
function gatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-pidgate-"));
  tmpDirs.push(dir);
  return join(dir, "pty-host.pid");
}

/** A genuinely dead pid: spawnSync blocks until the child exits, so its pid is
 *  no longer live when we read it back (pid reuse within the test is vanishingly
 *  unlikely, and the guard below would catch it). */
function deadPid(): number {
  const pid = spawnSync(process.execPath, ["-e", ""]).pid;
  if (pid === undefined || pidIsAlive(pid)) {
    throw new Error(`could not obtain a dead pid (got ${pid})`);
  }
  return pid;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    spawnSync("rm", ["-rf", d]);
  }
});

describe("pidGatePathForSocket", () => {
  it("swaps .sock for .pid in the same directory — one derivation", () => {
    expect(pidGatePathForSocket("/run/user/1000/kolu/pty-host.sock")).toBe(
      "/run/user/1000/kolu/pty-host.pid",
    );
    // A socket path without the .sock suffix still yields a sibling .pid.
    expect(pidGatePathForSocket("/tmp/k/pty-host")).toBe("/tmp/k/pty-host.pid");
  });
});

describe("pidIsAlive", () => {
  it("is true for this process and false for a dead/invalid pid", () => {
    expect(pidIsAlive(process.pid)).toBe(true);
    expect(pidIsAlive(deadPid())).toBe(false);
    expect(pidIsAlive(0)).toBe(false);
    expect(pidIsAlive(-1)).toBe(false);
  });
});

describe("acquirePidGate — single-instance choreography", () => {
  it("A acquires a free gate and records its pid", () => {
    const path = gatePath();
    const res = acquirePidGate(path, { pid: process.pid });
    expect(res.acquired).toBe(true);
    expect(readPidGate(path)).toBe(process.pid);
  });

  it("B is refused while a live holder (A) owns the gate", () => {
    const path = gatePath();
    const a = acquirePidGate(path, { pid: process.pid });
    expect(a.acquired).toBe(true);

    // A contender whose own pid is irrelevant — what matters is that the
    // recorded holder (this live process) is alive, so B must not steal it.
    const b = acquirePidGate(path, { pid: 999_999 });
    expect(b).toEqual({ acquired: false, holderPid: process.pid });
    // The gate still belongs to A — B left no trace.
    expect(readPidGate(path)).toBe(process.pid);
  });

  it("C reclaims a gate whose holder (A) has died", () => {
    const path = gatePath();
    writeFileSync(path, `${deadPid()}\n`);
    const c = acquirePidGate(path, { pid: process.pid });
    expect(c.acquired).toBe(true);
    expect(readPidGate(path)).toBe(process.pid);
  });

  it("a half-written gate is impossible — the linked file is always complete", () => {
    // Acquire never leaves an empty gate behind even mid-contention: after a
    // successful acquire the gate holds a parseable pid, never "".
    const path = gatePath();
    acquirePidGate(path, { pid: process.pid });
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));
  });
});

describe("acquirePidGate — release", () => {
  it("removes our own gate, and is idempotent", () => {
    const path = gatePath();
    const res = acquirePidGate(path, { pid: process.pid });
    if (!res.acquired) throw new Error("expected acquire");
    res.gate.release();
    expect(existsSync(path)).toBe(false);
    res.gate.release(); // no throw on a second call
    expect(existsSync(path)).toBe(false);
  });

  it("never clobbers a successor that re-acquired the same path", () => {
    const path = gatePath();
    const res = acquirePidGate(path, { pid: process.pid });
    if (!res.acquired) throw new Error("expected acquire");
    // A successor (different pid) takes over the gate file underneath us.
    writeFileSync(path, "424242\n");
    res.gate.release();
    // Our release saw a foreign pid and left the successor's gate intact.
    expect(readPidGate(path)).toBe(424242);
  });
});
