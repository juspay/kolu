/**
 * The pid-gate mechanism, unit-level — acquire / held / stale-reap / release /
 * read, with real OS pids for the liveness probe (a live child for "held", a
 * reaped child for "stale"). Pins the pid-first tolerant-reader law, the ±2 s
 * start-time tolerance, and the #2011 one-field recycle path.
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
  claimPidGate,
  confirmHeldGate,
  gateIdentity,
  gatePid,
  identitiesMatch,
  isHolderLive,
  liveHolderPid,
  type ProcessIdentity,
  readGateIdentity,
  START_TIME_TOLERANCE_US,
  startTimesMatch,
} from "./pidGate.ts";

const SELF: ProcessIdentity = { pid: process.pid, startUnixUs: 1_000_000 };
const identities = new Map<number, ProcessIdentity>([[process.pid, SELF]]);
const readIdentity = (pid: number): ProcessIdentity | undefined =>
  identities.get(pid);

/** The supervisor's read for two-field-aware live holders. */
function liveHolder(gatePath: string): number | undefined {
  return liveHolderPid(gatePath, readIdentity);
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
  it("acquires a free gate, records two-field identity, and release removes it", () => {
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

  it("reports `held` (not acquired) when a live process owns the two-field gate", () => {
    const path = gateIn();
    const otherPid = liveChild();
    const other = identities.get(otherPid)!;
    writeFileSync(path, `${other.pid}\t${other.startUnixUs}\n`);

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${other.pid}\t${other.startUnixUs}`,
    );
  });

  it("holds a legacy one-field gate when the pid is live (#2011 path)", () => {
    const path = gateIn();
    const otherPid = liveChild();
    writeFileSync(path, `${otherPid}\n`);

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    // gatePid still yields the pid so recycle can SIGTERM (the #2011 fix).
    expect(gatePid(path)).toBe(otherPid);
  });

  it("reaps a stale two-field gate (dead holder) and acquires it", async () => {
    const path = gateIn();
    const dead = await deadPid();
    writeFileSync(path, `${dead}\t1\n`);

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });

  it("reaps a stale one-field gate (dead holder) and acquires it", async () => {
    const path = gateIn();
    writeFileSync(path, `${await deadPid()}\n`);

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
    const path = gateIn();
    const dir = dirname(path);
    const holderPid = liveChild();
    const holder = identities.get(holderPid)!;
    writeFileSync(path, `${holder.pid}\t${holder.startUnixUs}\n`);
    chmodSync(dir, 0o755);

    const gate = acquirePidGate(path, SELF, readIdentity);
    if (process.getuid === undefined) {
      expect(gate.kind).toBe("held");
      return;
    }
    expect(gate).toEqual({ kind: "dir-not-private", dir });
  });

  it("release does not remove a gate that a successor now owns", () => {
    const path = gateIn();
    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");

    const successor = liveChild();
    const successorIdentity = identities.get(successor)!;
    writeFileSync(
      path,
      `${successorIdentity.pid}\t${successorIdentity.startUnixUs}\n`,
    );

    if (gate.kind === "acquired") gate.release();
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${successorIdentity.pid}\t${successorIdentity.startUnixUs}`,
    );
  });

  it("reaps a live reused pid whose start time no longer matches", () => {
    const path = gateIn();
    const pid = liveChild();
    const current = identities.get(pid)!;
    // Plant a start time far outside tolerance — pid-reuse.
    writeFileSync(
      path,
      `${pid}\t${current.startUnixUs - START_TIME_TOLERANCE_US - 1}\n`,
    );

    const gate = acquirePidGate(path, SELF, readIdentity);
    expect(gate.kind).toBe("acquired");
    expect(liveHolder(path)).toBe(process.pid);
  });
});

describeDaemon("pid-first tolerant reader", () => {
  it("yields the pid from a two-field write through the legacy parseInt path (rollback contract)", () => {
    const path = gateIn();
    const body = `${4242}\t${9_001_000}\n`;
    writeFileSync(path, body);
    // The previous-release reader: Number.parseInt stops at the tab.
    expect(Number.parseInt(readFileSync(path, "utf8").trim(), 10)).toBe(4242);
    expect(gatePid(path)).toBe(4242);
    expect(gateIdentity(path)).toEqual({ pid: 4242, startUnixUs: 9_001_000 });
  });

  it("yields the pid from a legacy one-field gate (the #2011 incident)", () => {
    const path = gateIn();
    writeFileSync(path, "772500\n");
    expect(readGateIdentity(path)).toEqual({ kind: "ok", pid: 772500 });
    expect(gatePid(path)).toBe(772500);
    expect(gateIdentity(path)).toBeUndefined(); // start unknown
  });

  it("ignores a third field — first token is still the pid", () => {
    const path = gateIn();
    writeFileSync(path, "99\t1000\textra\n");
    expect(gatePid(path)).toBe(99);
    expect(gateIdentity(path)).toEqual({ pid: 99, startUnixUs: 1000 });
  });

  it("treats a non-numeric second field as one-field (pid still usable)", () => {
    const path = gateIn();
    writeFileSync(path, "55\tnot-a-start\n");
    expect(readGateIdentity(path)).toEqual({ kind: "ok", pid: 55 });
    expect(gatePid(path)).toBe(55);
  });

  it("parseInt residue: space after pid is one-field (pid 123)", () => {
    const path = gateIn();
    writeFileSync(path, "123 456\n");
    expect(readGateIdentity(path)).toEqual({ kind: "ok", pid: 123 });
    expect(gatePid(path)).toBe(123);
    expect(gateIdentity(path)).toBeUndefined();
  });

  it("parseInt residue: hyphen after pid is one-field (pid 123)", () => {
    const path = gateIn();
    writeFileSync(path, "123-garbage\n");
    expect(readGateIdentity(path)).toEqual({ kind: "ok", pid: 123 });
    expect(gatePid(path)).toBe(123);
  });

  it("wholly non-digit-leading content is malformed", () => {
    const path = gateIn();
    writeFileSync(path, "garbage\n");
    expect(readGateIdentity(path)).toEqual({ kind: "malformed" });
    expect(gatePid(path)).toBeUndefined();
  });
});

describeDaemon("claimPidGate mid-boot (F1)", () => {
  it("two-field match + no socket (absent) → held (never reap)", async () => {
    const path = gateIn();
    const otherPid = liveChild();
    const other = identities.get(otherPid)!;
    writeFileSync(path, `${other.pid}\t${other.startUnixUs}\n`);
    // No co-located socket file at all (mid-boot / absent).
    const absentSocket = join(dirname(path), "missing.sock");
    const gate = await claimPidGate(path, absentSocket, SELF, readIdentity);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8").trim()).toBe(
      `${other.pid}\t${other.startUnixUs}`,
    );
  });

  it("two-field match + dead socket inode → held (identity is truth, not socket)", async () => {
    // Distinguishes the two-field early-return from one-field: a non-socket
    // path is socketServeState "dead". One-field would reclaim; two-field must not.
    const path = gateIn();
    const otherPid = liveChild();
    const other = identities.get(otherPid)!;
    writeFileSync(path, `${other.pid}\t${other.startUnixUs}\n`);
    const deadSocket = join(dirname(path), "stale.sock");
    writeFileSync(deadSocket, "not-a-socket");
    const gate = await claimPidGate(path, deadSocket, SELF, readIdentity);
    expect(gate).toEqual({ kind: "held", pid: otherPid });
    expect(existsSync(path)).toBe(true);
  });

  it("one-field live + absent socket → confirmHeldGate keeps held (F12 fence)", async () => {
    const path = gateIn();
    const otherPid = liveChild();
    writeFileSync(path, `${otherPid}\n`);
    const absentSocket = join(dirname(path), "missing.sock");
    const held = acquirePidGate(path, SELF, readIdentity);
    expect(held.kind).toBe("held");
    if (held.kind !== "held") throw new Error("unreachable");
    const confirmed = await confirmHeldGate(
      held,
      path,
      absentSocket,
      SELF,
      readIdentity,
    );
    expect(confirmed).toEqual({ kind: "held", pid: otherPid });
    expect(existsSync(path)).toBe(true);
  });
});

describeDaemon("start-time tolerance (±2 s)", () => {
  it("matches within tolerance (holder not lost to clock skew)", () => {
    const recorded = { pid: 1, startUnixUs: 10_000_000 };
    const skewed = {
      pid: 1,
      startUnixUs: 10_000_000 + START_TIME_TOLERANCE_US,
    };
    expect(startTimesMatch(recorded.startUnixUs, skewed.startUnixUs)).toBe(
      true,
    );
    expect(identitiesMatch(recorded, skewed)).toBe(true);
  });

  it("rejects beyond tolerance (pid-reuse)", () => {
    const recorded = { pid: 1, startUnixUs: 10_000_000 };
    const reused = {
      pid: 1,
      startUnixUs: 10_000_000 + START_TIME_TOLERANCE_US + 1,
    };
    expect(startTimesMatch(recorded.startUnixUs, reused.startUnixUs)).toBe(
      false,
    );
    expect(identitiesMatch(recorded, reused)).toBe(false);
  });

  it("liveHolderPid keeps a holder whose start time is within tolerance", () => {
    const path = gateIn();
    const pid = liveChild();
    const current = identities.get(pid)!;
    writeFileSync(
      path,
      `${pid}\t${current.startUnixUs - START_TIME_TOLERANCE_US}\n`,
    );
    expect(liveHolder(path)).toBe(pid);
  });

  it("liveHolderPid drops a holder whose start time is beyond tolerance", () => {
    const path = gateIn();
    const pid = liveChild();
    const current = identities.get(pid)!;
    writeFileSync(
      path,
      `${pid}\t${current.startUnixUs - START_TIME_TOLERANCE_US - 1}\n`,
    );
    expect(liveHolder(path)).toBeUndefined();
  });
});

describeDaemon("liveHolder (supervisor read)", () => {
  it("returns undefined for an absent gate", () => {
    expect(liveHolder(gateIn())).toBeUndefined();
  });

  it("returns the live holder's pid (two-field)", () => {
    const path = gateIn();
    const pid = liveChild();
    const identity = identities.get(pid)!;
    writeFileSync(path, `${identity.pid}\t${identity.startUnixUs}\n`);
    expect(liveHolder(path)).toBe(pid);
  });

  it("returns the live holder's pid (one-field, kill-0)", () => {
    const path = gateIn();
    const pid = liveChild();
    writeFileSync(path, `${pid}\n`);
    expect(liveHolder(path)).toBe(pid);
    expect(isHolderLive(pid)).toBe(true);
  });

  it("returns undefined for a stale gate", async () => {
    const path = gateIn();
    writeFileSync(path, `${await deadPid()}\t1\n`);
    expect(liveHolder(path)).toBeUndefined();
  });
});
