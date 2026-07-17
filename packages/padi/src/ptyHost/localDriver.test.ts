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

  it("carries the allowlist base + operational vars, and NO leaked identity var", () => {
    process.env.HOME = "/home/prod";
    process.env.PATH = "/run/current-system/sw/bin:/usr/bin";
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    // the #1872 leak in the supervisor's own env — must NOT reach kaval:
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.AWS_SECRET_ACCESS_KEY = "shhh";

    const env = daemonEnv();

    // complete base — kaval gets HOME/PATH (parity with systemd's PAM env):
    expect(env.HOME).toBe("/home/prod");
    expect(env.PATH).toBe("/run/current-system/sw/bin:/usr/bin");
    // XDG_RUNTIME_DIR rides in via the shared allowlist base (it is a
    // SPAWN_ENV_OPERATIONAL member), not a hand-carried extra:
    expect(env.XDG_RUNTIME_DIR).toBe("/run/user/1000");
    // the ambient identity/secret never rides in:
    expect("CLAUDE_CODE_CHILD_SESSION" in env).toBe(false);
    expect("AWS_SECRET_ACCESS_KEY" in env).toBe(false);

    // every key is either on the shared allowlist or a named operational var — the
    // exact set, so a future broad addition fails THIS test, not review vigilance.
    const OPERATIONAL = ["NODE_OPTIONS", "KOLU_DIAG_DIR", DAEMON_BIND_PID_ENV];
    const allowed = new Set<string>([...SPAWN_ENV_ALLOWLIST, ...OPERATIONAL]);
    for (const k of Object.keys(env)) {
      expect(allowed.has(k)).toBe(true);
    }
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
