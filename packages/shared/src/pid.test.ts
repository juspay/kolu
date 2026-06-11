import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquirePidGate, pidIsAlive, readPidGate } from "./pid.ts";

const DEAD_PID = 0x7fffffff; // above PID_MAX everywhere — cannot exist

describe("pidIsAlive", () => {
  it("reports the current process as alive", () => {
    expect(pidIsAlive(process.pid)).toBe(true);
  });
  it("reports a certainly-dead pid as gone", () => {
    expect(pidIsAlive(DEAD_PID)).toBe(false);
  });
  it("rejects non-positive / non-integer pids without probing", () => {
    expect(pidIsAlive(0)).toBe(false);
    expect(pidIsAlive(-1)).toBe(false);
    expect(pidIsAlive(Number.NaN)).toBe(false);
  });
});

describe("pid-gate", () => {
  let dir: string;
  let gatePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kolu-pidgate-"));
    gatePath = join(dir, "nested", "pty-host.pid");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires a fresh gate, creating parent dirs and writing our pid", () => {
    const res = acquirePidGate(gatePath);
    expect(res.kind).toBe("acquired");
    if (res.kind !== "acquired") return;
    expect(res.gate.pid).toBe(process.pid);
    expect(Number.parseInt(readFileSync(gatePath, "utf8").trim(), 10)).toBe(
      process.pid,
    );
    expect(readPidGate(gatePath)).toBe(process.pid);
  });

  it("reports 'held' when a live process already owns the gate", () => {
    const first = acquirePidGate(gatePath);
    expect(first.kind).toBe("acquired");
    const second = acquirePidGate(gatePath);
    expect(second).toEqual({ kind: "held", byPid: process.pid });
  });

  it("takes over a stale gate left by a dead process", () => {
    mkdirSync(dirname(gatePath), { recursive: true });
    // A prior daemon was SIGKILLed mid-life — its pid file lingers, dead.
    writeFileSync(gatePath, `${DEAD_PID}\n`);
    expect(readPidGate(gatePath)).toBeNull(); // stale → no live owner
    const res = acquirePidGate(gatePath);
    expect(res.kind).toBe("acquired");
    expect(readPidGate(gatePath)).toBe(process.pid);
  });

  it("release removes the gate, and is idempotent", () => {
    const res = acquirePidGate(gatePath);
    if (res.kind !== "acquired") throw new Error("expected acquired");
    res.gate.release();
    expect(readPidGate(gatePath)).toBeNull();
    expect(() => res.gate.release()).not.toThrow();
  });

  it("release leaves a successor's gate untouched", () => {
    const res = acquirePidGate(gatePath);
    if (res.kind !== "acquired") throw new Error("expected acquired");
    // A successor reclaimed the path and wrote a different pid into it.
    writeFileSync(gatePath, `${DEAD_PID}\n`);
    res.gate.release(); // we owned process.pid; the file now claims DEAD_PID
    expect(rawClaimed(gatePath)).toBe(DEAD_PID); // not unlinked
  });

  it("readPidGate returns null for an absent gate", () => {
    expect(readPidGate(join(dir, "nope.pid"))).toBeNull();
  });
});

function rawClaimed(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}
