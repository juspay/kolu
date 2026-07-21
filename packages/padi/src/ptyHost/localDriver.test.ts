/**
 * kaval is ALWAYS told to serve the caller's resolved socket via `--socket`, so
 * the spawned daemon lands on the exact path padi dials — never on kaval's bare
 * default namespace. padi keys that path by a DIGEST of its state-root
 * (`kaval-<digest>/pty-host.sock`), and `KOLU_KAVAL_SOCKET` still overrides the
 * whole path (the e2e harness pins it); either way `resolveKavalLaunch` forwards
 * exactly what it is given.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAEMON_BIND_PID_ENV } from "@kolu/surface-daemon";
import { SPAWN_ENV_ALLOWLIST } from "kolu-pty";
import {
  daemonEnv,
  localKavalDriver,
  resolveKavalLaunch,
} from "./localDriver.ts";

describe("kaval launch resolution", () => {
  let savedBin: string | undefined;

  beforeEach(() => {
    savedBin = process.env.KOLU_KAVAL_BIN;
  });

  afterEach(() => {
    restore("KOLU_KAVAL_BIN", savedBin);
  });

  it("always forwards the resolved socket to the spawned kaval via --socket", () => {
    process.env.KOLU_KAVAL_BIN = "/nix/store/abc/bin/kaval";
    const socketPath = "/run/user/1000/kaval-x/pty-host.sock";

    // The daemon is told to serve exactly the path padi dials — never its own
    // bare default namespace.
    expect(resolveKavalLaunch(socketPath)).toEqual({
      binPath: "/nix/store/abc/bin/kaval",
      args: ["--socket", socketPath],
    });
  });
});

describe("localKavalDriver — the A8 runtime spawn leash at the real funnel (F5)", () => {
  const savedGate = process.env.KOLU_DAEMON_TESTS;
  afterEach(() => {
    restore("KOLU_DAEMON_TESTS", savedGate);
  });

  it("REFUSES to spawn in a gate-off vitest worker (helper indirection can't smuggle a real kaval fork)", () => {
    // Force the gate OFF regardless of the lane this test runs in — the property is
    // "a bare vitest never forks a real kaval". VITEST is already set in every worker.
    delete process.env.KOLU_DAEMON_TESTS;
    const driver = localKavalDriver("/run/user/1000/kaval-x/pty-host.sock");
    expect(() => driver.spawn()).toThrow(/KOLU_DAEMON_TESTS/);
  });
});

describe("daemonEnv — the env kaval is spawned with (2a parity pin, #1872)", () => {
  // The supervisor's detached branch runs kaval with `cfg.env` ALONE (no parent env
  // layered — that would leak the supervisor's ambient identity into kaval and every
  // PTY). So `daemonEnv()` must be a COMPLETE, clean env: the shared allowlist base
  // PLUS kaval's operational vars — and NEVER an ambient identity var. Pinned as data
  // so neither this nor the supervisor's env branch can drift silently.
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("is EXACTLY every allowlist key + every operational extra — no dropped base key, no leaked ambient key (#1872)", () => {
    // Seed EVERY allowlist key AND every optional operational input, then assert the
    // WHOLE returned object with `toEqual`: a dropped base key, a dropped operational
    // extra, OR a leaked ambient key all fail — not just a membership check.
    for (const k of Object.keys(process.env)) delete process.env[k];
    const expected: Record<string, string> = {};
    for (const k of SPAWN_ENV_ALLOWLIST) {
      process.env[k] = `val-${k}`;
      expected[k] = `val-${k}`;
    }
    // Operational extras (NODE_OPTIONS is scrubbed — set a value with no dev flags):
    process.env.NODE_OPTIONS = "--max-old-space-size=4096";
    process.env.KOLU_DIAG_DIR = "/diag";
    process.env[DAEMON_BIND_PID_ENV] = "4321";
    expected.NODE_OPTIONS = "--max-old-space-size=4096";
    expected.KOLU_DIAG_DIR = "/diag";
    expected[DAEMON_BIND_PID_ENV] = "4321";
    // Ambient identity/secret in the supervisor's own env — must NOT reach kaval:
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.AWS_SECRET_ACCESS_KEY = "shhh";

    expect(daemonEnv()).toEqual(expected);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
