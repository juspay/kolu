/**
 * Env-layering parity guard for `buildTerminalSpawnInput`.
 *
 * The whole inversion's "byte-identical to the pre-inversion daemon" claim
 * funnels through this one function's three-layer env merge, documented in
 * ptyHost.ts as least → most authoritative:
 *   1. cleanEnv()        — parent env passthrough (sentinel COLORTERM here).
 *   2. koluIdentityEnv() — kolu's identity vars (stomp parent).
 *   3. plan.env          — per-PTY overrides (ZDOTDIR for zsh).
 *
 * The golden `prepareShellInit` tests in kolu-pty's shell.test.ts cover the
 * plan but not the merge — these lock the precedence so a future edit that
 * reorders the two `Object.assign`s (letting identity vars stomp ZDOTDIR, or
 * the parent stomp identity) fails here instead of silently shipping.
 */

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTerminalSpawnInput } from "./ptyHost.ts";

describe("buildTerminalSpawnInput env layering", () => {
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

  it("koluIdentityEnv overrides a same-named cleanEnv (parent) key", async () => {
    // cleanEnv() passes process.env through, so a parent COLORTERM is in the
    // base layer. koluIdentityEnv layers COLORTERM=truecolor on top — the
    // identity assertion must win over whatever the parent happened to carry.
    process.env.COLORTERM = "PARENT_SENTINEL";
    const input = await buildTerminalSpawnInput({ id: "T-colorterm" });
    expect(input.env.COLORTERM).toBe("truecolor");
  });

  it("plan.env (ZDOTDIR) survives over both cleanEnv and koluIdentityEnv", async () => {
    // Force a zsh shell so prepareShellInit returns a ZDOTDIR override; it is
    // the most-authoritative layer (applied last) and must reach the wire
    // unclobbered — the bytes that make the zsh wrapper rcfile load.
    process.env.SHELL = "/bin/zsh";
    const id = "T-zdotdir";
    const input = await buildTerminalSpawnInput({ id });
    expect(input.argv[0]).toBe("/bin/zsh");
    expect(input.env.ZDOTDIR).toBe(join(rcDirOf(input), `zdotdir-${id}`));
  });
});

/** Recover the rcDir the host planned against from the ZDOTDIR it produced —
 *  the parent of the per-terminal zdotdir dir. Keeps the test from importing
 *  the server's private koluShellDir while still asserting the path is real. */
function rcDirOf(input: { env: Record<string, string> }): string {
  const zdotdir = input.env.ZDOTDIR;
  if (!zdotdir) throw new Error("expected ZDOTDIR in zsh spawn input");
  return join(zdotdir, "..");
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
