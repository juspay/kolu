import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
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
    delete process.env.KOLU_DAEMON_TESTS;
    const driver = localKavalDriver("/run/user/1000/kaval-x/pty-host.sock");
    expect(() => Effect.runSync(driver.spawn)).toThrow(/KOLU_DAEMON_TESTS/);
  });
});

describe("daemonEnv — the env kaval is spawned with (2a parity pin, #1872)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("is EXACTLY every allowlist key + every operational extra — no dropped base key, no leaked ambient key (#1872)", () => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    const expected: Record<string, string> = {};
    for (const k of SPAWN_ENV_ALLOWLIST) {
      process.env[k] = `val-${k}`;
      expected[k] = `val-${k}`;
    }
    process.env.NODE_OPTIONS = "--max-old-space-size=4096";
    process.env.KOLU_DIAG_DIR = "/diag";
    process.env[DAEMON_BIND_PID_ENV] = "4321";
    expected.NODE_OPTIONS = "--max-old-space-size=4096";
    expected.KOLU_DIAG_DIR = "/diag";
    expected[DAEMON_BIND_PID_ENV] = "4321";
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.AWS_SECRET_ACCESS_KEY = "shhh";

    expect(daemonEnv()).toEqual(expected);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
