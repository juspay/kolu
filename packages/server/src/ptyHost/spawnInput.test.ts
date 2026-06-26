/**
 * Env-layering parity guard for the spawn-input composition.
 *
 * The whole inversion's "byte-identical to the pre-inversion daemon" claim
 * funnels through `composeSpawnInput`'s three-layer env merge, least → most
 * authoritative:
 *   1. cleanEnv()        — parent env passthrough (sentinel COLORTERM here).
 *   2. koluIdentityEnv() — kolu's identity vars (stomp parent).
 *   3. plan.env          — per-PTY overrides (ZDOTDIR for zsh).
 *
 * `composeSpawnInput` is the PURE half (it takes `system.info` as an argument),
 * so these lock the precedence without a live daemon — a future edit that
 * reorders the two `Object.assign`s (letting identity vars stomp ZDOTDIR, or the
 * parent stomp identity) fails here instead of silently shipping. The golden
 * `prepareShellInit` tests in kolu-pty's shell.test.ts cover the plan itself.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_RETENTION_BYTES, type PtyHostSystemInfo } from "kaval";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { composeSpawnInput } from "./index.ts";

const RC_DIR = mkdtempSync(join(tmpdir(), "spawn-input-rc-"));

/** A host-facts fixture standing in for the daemon's `system.info`. */
function info(over: Partial<PtyHostSystemInfo> = {}): PtyHostSystemInfo {
  return {
    shell: "/bin/sh",
    home: "/home/test",
    platform: "linux",
    rcDir: RC_DIR,
    ...over,
  } as PtyHostSystemInfo;
}

describe("composeSpawnInput env layering", () => {
  let savedShell: string | undefined;
  let savedColorterm: string | undefined;

  beforeEach(() => {
    savedShell = process.env.SHELL;
    savedColorterm = process.env.COLORTERM;
  });

  afterEach(() => {
    restore("SHELL", savedShell);
    restore("COLORTERM", savedColorterm);
  });

  it("koluIdentityEnv overrides a same-named cleanEnv (parent) key", () => {
    // cleanEnv() passes process.env through, so a parent COLORTERM is in the
    // base layer. koluIdentityEnv layers COLORTERM=truecolor on top — the
    // identity assertion must win over whatever the parent happened to carry.
    process.env.COLORTERM = "PARENT_SENTINEL";
    const input = composeSpawnInput({ id: "T-colorterm" }, info());
    expect(input.env.COLORTERM).toBe("truecolor");
  });

  it("plan.env (ZDOTDIR) survives over both cleanEnv and koluIdentityEnv", () => {
    // Force a zsh shell so prepareShellInit returns a ZDOTDIR override; it is
    // the most-authoritative layer (applied last) and must reach the wire
    // unclobbered — the bytes that make the zsh wrapper rcfile load.
    process.env.SHELL = "/bin/zsh";
    const id = "T-zdotdir";
    const input = composeSpawnInput({ id }, info());
    expect(input.argv[0]).toBe("/bin/zsh");
    expect(input.env.ZDOTDIR).toBe(join(RC_DIR, `zdotdir-${id}`));
  });

  it("local env SHELL wins over system.info.shell (the local-host boundary)", () => {
    // Boundary pin: today the host IS this process, so cleanEnv()'s local SHELL
    // is authoritative and system.info.shell is only a fallback. A future remote
    // host (R-2) must invert this — host facts winning over the server's env —
    // so locking the current local-wins ordering makes that change deliberate.
    process.env.SHELL = "/bin/zsh";
    const input = composeSpawnInput(
      { id: "T-local-shell" },
      info({ shell: "/bin/dash" }),
    );
    expect(input.argv[0]).toBe("/bin/zsh");
  });

  it("resolves a real shell when the local env omits SHELL", () => {
    // With SHELL absent from the parent env, the composition still resolves a
    // real absolute shell rather than crashing — the same path a systemd user
    // service (no SHELL) exercises. cleanEnv() backstops SHELL from /etc/passwd,
    // and system.info.shell is the final fallback when even that is empty, so
    // the resolved shell is always a real path.
    delete process.env.SHELL;
    const input = composeSpawnInput(
      { id: "T-fallback-shell" },
      info({ shell: "/bin/bash" }),
    );
    expect(input.argv[0]?.startsWith("/")).toBe(true);
  });
});

describe("composeSpawnInput history policy (PR2)", () => {
  it("sends a required history policy: enabled, with the default retention cap", () => {
    // PR2 dropped `scrollback` from the wire (the mirror is pinned to the hot
    // window in-kaval) and added a REQUIRED history policy — the daemon derives
    // nothing, so the server must compose it explicitly. Default ON with the
    // standard retention cap; deep history lives in the on-disk transcript.
    const input = composeSpawnInput({ id: "T-history" }, info());
    expect(input.history).toEqual({
      enabled: true,
      retentionBytes: DEFAULT_RETENTION_BYTES,
    });
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
