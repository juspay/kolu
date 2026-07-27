/**
 * The pid-gate mechanism, unit-level — acquire / held / stale-reap / release /
 * read, with real OS pids for the liveness probe (a live child for "held", a
 * reaped child for "stale"). The cross-*process* race choreography against a
 * real spawned daemon lives in kaval's e2e; here we pin the file-format and
 * liveness logic that both sides share — including `liveHolder`, the exact
 * composition (`isHolderLive(gatePid(path))`) the B2 supervisor will run.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterEach, expect, it } from "vitest";
import {
  acquirePidGate,
  gateIdentity,
  type ProcessIdentity,
} from "./pidGate.ts";

const SELF: ProcessIdentity = { pid: process.pid, startUnixUs: 1_000_000 };
const identities = new Map<number, ProcessIdentity>([[process.pid, SELF]]);
const readIdentity = (pid: number): ProcessIdentity | undefined =>
  identities.get(pid);

/** The supervisor's read, composed from the shared primitives: the live
 *  holder's pid, or `undefined` (absent, malformed, or stale). */
function liveHolder(gatePath: string): number | undefined {
  const recorded = gateIdentity(gatePath);
  if (recorded === undefined) return undefined;
  const current = readIdentity(recorded.pid);
  return current?.startUnixUs === recorded.startUnixUs
    ? recorded.pid
    : undefined;
}

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

/** A live child process whose pid we can plant in a gate. */
function liveChild(): number {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  children.push(child);
  if (child.pid === undefined) throw new Error("child failed to start");
  identities.set(child.pid, { pid: child.pid, startUnixUs: child.pid * 1_000 });
  return child.pid;
}

/** A pid that is definitely dead — spawn a child, kill it, await its exit. */
async function deadPid(): Promise<number> {
  assertDaemonSpawnAllowed("a short-lived liveness-probe child");
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

describeDaemon("acquirePidGate", () => {
  it("acquires a free gate, records this pid, and release removes it", () => {
    const path = gateIn();
    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${process.pid}\t${SELF.startUnixUs}`,
    );

    if (gate.kind === "acquired") gate.release();
    expect(existsSync(path)).toBe(false);
    expect(liveHolder(path)).toBeUndefined();
  });

  it("reports `held` (not acquired) when a live process owns the gate", () => {
    const path = gateIn();
    const otherPid = liveChild();
    const other = identities.get(otherPid)!;
    writeFileSync(path, `${other.pid}\t${other.startUnixUs}\n`);

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    // The live holder's gate is left untouched.
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${other.pid}\t${other.startUnixUs}`,
    );
  });

  it("reaps a stale gate (dead holder) and acquires it", async () => {
    const path = gateIn();
    const dead = await deadPid();
    writeFileSync(path, `${dead}\t1\n`);

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });

  it("reaps a malformed gate (garbage content) and acquires it", () => {
    const path = gateIn();
    writeFileSync(path, "not-a-pid\n");

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });

  it("refuses (dir-not-private) when the gate dir is group/other-accessible", () => {
    // Simulate the multi-user `/tmp/<app>-$UID` attack: a loose-perm dir with a
    // pre-seeded gate holding a live pid. Honoring it would DoS the daemon
    // (exit 0 as "already running") before the socket-side privacy check runs.
    const path = gateIn();
    const dir = dirname(path);
    const holderPid = liveChild();
    const holder = identities.get(holderPid)!;
    writeFileSync(path, `${holder.pid}\t${holder.startUnixUs}\n`);
    chmodSync(dir, 0o755);

    const gate = acquirePidGate(path, SELF, readIdentity);
    if (process.getuid === undefined) {
      // No uid semantics (Windows): the check is a no-op and the live gate is
      // honored — nothing to assert about privacy here.
      expect(gate.kind).toBe("held");
      return;
    }
    expect(gate).toEqual({ kind: "dir-not-private", dir });
  });

  it("release does not remove a gate that a successor now owns", () => {
    const path = gateIn();
    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");

    // A successor takes the gate (simulated by overwriting the pid).
    const successor = liveChild();
    const successorIdentity = identities.get(successor)!;
    writeFileSync(
      path,
      `${successorIdentity.pid}\t${successorIdentity.startUnixUs}\n`,
    );

    if (gate.kind === "acquired") gate.release();
    // The successor's gate survives our (late) release.
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${successorIdentity.pid}\t${successorIdentity.startUnixUs}`,
    );
  });
});

describeDaemon("liveHolder (supervisor read)", () => {
  it("returns undefined for an absent gate", () => {
    expect(liveHolder(gateIn())).toBeUndefined();
  });

  it("returns the live holder's pid", () => {
    const path = gateIn();
    const pid = liveChild();
    const identity = identities.get(pid)!;
    writeFileSync(path, `${identity.pid}\t${identity.startUnixUs}\n`);
    expect(liveHolder(path)).toBe(pid);
  });

  it("returns undefined for a stale gate", async () => {
    const path = gateIn();
    writeFileSync(path, `${await deadPid()}\t1\n`);
    expect(liveHolder(path)).toBeUndefined();
  });

  it("rejects a live reused pid whose start time no longer matches", () => {
    const path = gateIn();
    const pid = liveChild();
    const current = identities.get(pid)!;
    writeFileSync(path, `${pid}\t${current.startUnixUs - 1}\n`);
    expect(liveHolder(path)).toBeUndefined();
  });
});
