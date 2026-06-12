/**
 * The pid-gate mechanism, unit-level — acquire / held / stale-reap / release /
 * read, with real OS pids for the liveness probe (a live child for "held", a
 * reaped child for "stale"). The cross-*process* race choreography against a
 * real spawned daemon lives in kaval's e2e; here we pin the file-format and
 * liveness logic that both sides share — including `liveHolder`, the exact
 * composition (`isHolderLive(gatePid(path))`) the B2 supervisor will run.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquirePidGate, gatePid, isHolderLive } from "./pidGate.ts";

/** The supervisor's read, composed from the shared primitives: the live
 *  holder's pid, or `undefined` (absent, malformed, or stale). */
function liveHolder(gatePath: string): number | undefined {
  const pid = gatePid(gatePath);
  return pid !== undefined && isHolderLive(pid) ? pid : undefined;
}

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

/** A live child process whose pid we can plant in a gate. */
function liveChild(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  children.push(child);
  if (child.pid === undefined) throw new Error("child failed to start");
  return child.pid;
}

/** A pid that is definitely dead — spawn a child, kill it, await its exit. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child failed to start");
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.kill("SIGKILL");
  });
  return pid;
}

function gateIn(): string {
  return join(mkdtempSync(join(tmpdir(), "kaval-gate-")), "daemon.pid");
}

describe("acquirePidGate", () => {
  it("acquires a free gate, records this pid, and release removes it", () => {
    const path = gateIn();
    const gate = acquirePidGate(path);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
    expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));

    if (gate.kind === "acquired") gate.release();
    expect(existsSync(path)).toBe(false);
    expect(liveHolder(path)).toBeUndefined();
  });

  it("reports `held` (not acquired) when a live process owns the gate", () => {
    const path = gateIn();
    const otherPid = liveChild();
    writeFileSync(path, `${otherPid}\n`);

    const gate = acquirePidGate(path);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    // The live holder's gate is left untouched.
    expect(readFileSync(path, "utf8").trim()).toBe(String(otherPid));
  });

  it("reaps a stale gate (dead holder) and acquires it", async () => {
    const path = gateIn();
    writeFileSync(path, `${await deadPid()}\n`);

    const gate = acquirePidGate(path);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });

  it("reaps a malformed gate (garbage content) and acquires it", () => {
    const path = gateIn();
    writeFileSync(path, "not-a-pid\n");

    const gate = acquirePidGate(path);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });

  it("release does not remove a gate that a successor now owns", () => {
    const path = gateIn();
    const gate = acquirePidGate(path);
    expect(gate.kind).toBe("acquired");

    // A successor takes the gate (simulated by overwriting the pid).
    const successor = liveChild();
    writeFileSync(path, `${successor}\n`);

    if (gate.kind === "acquired") gate.release();
    // The successor's gate survives our (late) release.
    expect(readFileSync(path, "utf8").trim()).toBe(String(successor));
  });
});

describe("liveHolder (supervisor read)", () => {
  it("returns undefined for an absent gate", () => {
    expect(liveHolder(gateIn())).toBeUndefined();
  });

  it("returns the live holder's pid", () => {
    const path = gateIn();
    const pid = liveChild();
    writeFileSync(path, `${pid}\n`);
    expect(liveHolder(path)).toBe(pid);
  });

  it("returns undefined for a stale gate", async () => {
    const path = gateIn();
    writeFileSync(path, `${await deadPid()}\n`);
    expect(liveHolder(path)).toBeUndefined();
  });
});
