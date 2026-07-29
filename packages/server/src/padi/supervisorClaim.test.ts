/**
 * The LOCAL-supervisor ownership gate — the two-local-kolu war fence.
 *
 * These exercise the REAL {@link acquirePidGate} mechanism (not a mock) against a
 * private temp dir, injecting only the gate PATH, so the actual atomic claim +
 * stale-holder reap + owner-only-dir guard are what's under test — the same
 * machinery padi's `padi.pid` rides.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHolderLive } from "@kolu/surface-daemon";
import {
  claimLocalSupervisor,
  SUPERVISOR_GATE_FILE,
  SupervisorConflictError,
  supervisorConflictError,
  supervisorGatePath,
} from "./supervisorClaim.ts";

let dir: string;
const gatePath = (): string => join(dir, SUPERVISOR_GATE_FILE);
const resolveGatePath = () => gatePath();

/** Test identity inject — no osfacts dependency in the unit suite. */
const SELF = { pid: process.pid, startUnixUs: 1_000_000 };
const identityDeps = {
  processIdentity: SELF,
  readProcessIdentity: (pid: number) =>
    pid === process.pid
      ? SELF
      : isHolderLive(pid)
        ? { pid, startUnixUs: pid * 1_000 }
        : undefined,
};

beforeEach(() => {
  // `mkdtempSync` yields an owner-only 0700 dir, so the gate's dir-privacy guard
  // passes — the same boundary the real runtime dir gets.
  dir = mkdtempSync(join(tmpdir(), "kolu-supervisor-claim-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A definitely-dead pid — spawn a trivial process, let it exit, reuse its pid.
 *  Models a crashed predecessor supervisor's stale gate. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  const pid = child.pid;
  if (pid === undefined) throw new Error("could not spawn a throwaway process");
  return pid;
}

describe("claimLocalSupervisor", () => {
  it("claims a fresh gate as `self` and hands back a release", () => {
    const claim = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    expect(claim.kind).toBe("self");
    if (claim.kind !== "self") throw new Error("unreachable");
    expect(typeof claim.release).toBe("function");
    claim.release();
  });

  it("REFUSES a second supervisor on the same state root (the two-local-kolu war)", () => {
    // First kolu-server claims and HOLDS the gate.
    const first = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    expect(first.kind).toBe("self");

    // A second kolu-server pointed at the SAME state root finds a LIVE holder and
    // is refused — the fence that stops two supervisors draining one padi.
    const second = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    expect(second.kind).toBe("foreign");
    if (second.kind !== "foreign") throw new Error("unreachable");
    // The live holder is this very process (the gate was just claimed here).
    expect(second.pid).toBe(process.pid);
  });

  it("a SAME-LINEAGE restart (dead predecessor pid) reaps the stale gate and claims `self`", () => {
    // A crashed supervisor left its pid in the gate; the process is gone.
    writeFileSync(gatePath(), `${deadPid()}\n`);
    const claim = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    // The stale gate is reaped and the restart claims it — so it can still adopt /
    // drain its padi; only a LIVE foreign holder blocks.
    expect(claim.kind).toBe("self");
  });

  it("surfaces `dir-not-private` when the acquirer reports an untrusted gate dir", () => {
    const claim = claimLocalSupervisor("ignored", {
      acquire: () => ({ kind: "dir-not-private", dir: "/tmp/evil" }),
      ...identityDeps,
    });
    expect(claim).toEqual({ kind: "dir-not-private", dir: "/tmp/evil" });
  });
});

describe("supervisorGatePath", () => {
  it("names `supervisor.pid` in the padi runtime dir (beside padi.pid)", () => {
    const p = supervisorGatePath(join(tmpdir(), "some-state-root"));
    expect(p.endsWith(`/${SUPERVISOR_GATE_FILE}`)).toBe(true);
    // Same `padi-<digest>` drawer padi's own socket + gate live in. The `-<uid>`
    // suffix is the `/tmp` fallback decoration `getRuntimeSocketPath` adds when
    // `$XDG_RUNTIME_DIR` is unset (e.g. macOS), so allow it optionally.
    expect(p).toMatch(/padi-[0-9a-f]+(-\d+)?\/supervisor\.pid$/);
  });
});

describe("supervisorConflictError", () => {
  it("foreign: names the holder pid, the state dir, and the isolation remedy", () => {
    const err = supervisorConflictError(
      { kind: "foreign", pid: 4242 },
      "/home/u/.local/state/padi",
    );
    expect(err).toBeInstanceOf(SupervisorConflictError);
    expect(err.message).toContain("4242");
    expect(err.message).toContain("/home/u/.local/state/padi");
    // The remedy — how to run a second instance ON PURPOSE — must be spelled out.
    expect(err.message).toContain("KOLU_STATE_DIR");
    expect(err.message).toContain("KOLU_PADI_STATE_DIR");
  });

  it("dir-not-private: names the untrusted directory", () => {
    const err = supervisorConflictError(
      { kind: "dir-not-private", dir: "/tmp/shared" },
      "/state",
    );
    expect(err).toBeInstanceOf(SupervisorConflictError);
    expect(err.message).toContain("/tmp/shared");
  });
});
