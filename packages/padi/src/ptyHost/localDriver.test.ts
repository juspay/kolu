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
import { daemonEnv, resolveKavalLaunch } from "./localDriver.ts";

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

  it("is EXACTLY the allowlist base present (+ operational extras) — a dropped or added key both fail (#1872)", () => {
    // Control the SOURCE env precisely so the assertion is EXACT, not a membership
    // check a deletion would silently pass: clear, then set a known set. A regression
    // that starts daemonEnv from `{}` again (dropping HOME/PATH) fails `toEqual`, and a
    // leaked ambient identity var fails it too.
    for (const k of Object.keys(process.env)) delete process.env[k];
    process.env.HOME = "/home/prod";
    process.env.PATH = "/run/current-system/sw/bin:/usr/bin";
    process.env.XDG_RUNTIME_DIR = "/run/user/1000"; // operational, via the allowlist
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock"; // operational, via the allowlist
    // ambient identity/secret in the supervisor's own env — must NOT reach kaval:
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.AWS_SECRET_ACCESS_KEY = "shhh";

    // EXACT: the allowlist keys present, and nothing else (no operational extras set).
    expect(daemonEnv()).toEqual({
      HOME: "/home/prod",
      PATH: "/run/current-system/sw/bin:/usr/bin",
      XDG_RUNTIME_DIR: "/run/user/1000",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
    });
  });

  it("layers the operational extras (NODE_OPTIONS scrubbed, KOLU_DIAG_DIR, bind-pid) on top of the base", () => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    process.env.HOME = "/home/prod";
    process.env.NODE_OPTIONS = "--max-old-space-size=4096"; // survives the dev-flag scrub
    process.env.KOLU_DIAG_DIR = "/diag";
    process.env[DAEMON_BIND_PID_ENV] = "4321";

    expect(daemonEnv()).toEqual({
      HOME: "/home/prod",
      NODE_OPTIONS: "--max-old-space-size=4096",
      KOLU_DIAG_DIR: "/diag",
      [DAEMON_BIND_PID_ENV]: "4321",
    });
    // every key is on the allowlist or a NAMED operational extra — nothing else.
    const allowed = new Set<string>([
      ...SPAWN_ENV_ALLOWLIST,
      "NODE_OPTIONS",
      "KOLU_DIAG_DIR",
      DAEMON_BIND_PID_ENV,
    ]);
    for (const k of Object.keys(daemonEnv())) expect(allowed.has(k)).toBe(true);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
