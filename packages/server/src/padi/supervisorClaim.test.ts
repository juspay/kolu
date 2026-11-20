import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  testAcquireReadIdentity,
  testSelfIdentity,
} from "@kolu/surface-daemon-supervisor/createEndpoint.testlib";
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

const identityDeps = {
  processIdentity: testSelfIdentity,
  readProcessIdentity: testAcquireReadIdentity,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kolu-supervisor-claim-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
    const first = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    expect(first.kind).toBe("self");

    const second = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
    expect(second.kind).toBe("foreign");
    if (second.kind !== "foreign") throw new Error("unreachable");
    expect(second.pid).toBe(process.pid);
  });

  it("a SAME-LINEAGE restart (dead predecessor pid) reaps the stale gate and claims `self`", () => {
    writeFileSync(gatePath(), `${deadPid()}\n`);
    const claim = claimLocalSupervisor("ignored", {
      resolveGatePath,
      ...identityDeps,
    });
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
