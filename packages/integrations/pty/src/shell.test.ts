/**
 * Unit tests for shell.ts OSC injection functions.
 *
 * Tests the shell functions by executing them in a real bash/zsh subprocess
 * and asserting on the escape sequences they emit.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanEnv,
  koluIdentityEnv,
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
  OSC2_PREEXEC_BASH_GUARD,
  OSC2_PREEXEC_FN,
  OSC7_FN,
  prepareShellInit,
} from "./shell.ts";

/** Run a script in a clean bash subshell and return stdout. */
function runBash(script: string, cwd = "/tmp"): string {
  return execFileSync("bash", ["-c", script], { encoding: "utf8", cwd });
}

/** Run a script in a clean zsh subshell and return stdout. Skips if zsh unavailable. */
function runZsh(script: string, cwd = "/tmp"): string | null {
  try {
    return execFileSync("zsh", ["-c", script], { encoding: "utf8", cwd });
  } catch (err) {
    // zsh not installed — skip
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

describe("koluIdentityEnv", () => {
  it("returns Kolu's identity vars: TERM_PROGRAM, TERM_PROGRAM_VERSION, VTE_VERSION, COLORTERM", () => {
    const env = koluIdentityEnv("9.9.9");
    expect(env).toEqual({
      TERM_PROGRAM: "kolu",
      TERM_PROGRAM_VERSION: "9.9.9",
      VTE_VERSION: "7603",
      COLORTERM: "truecolor",
    });
  });

  it("asserts COLORTERM=truecolor so PTY tools emit 24-bit color escapes", () => {
    // kolu's xterm.js WebGL renderer displays 24-bit color, so the
    // assertion is honest. Unconditional (not passthrough) because a
    // GUI/launchd launch carries no parent COLORTERM to forward, yet the
    // renderer is just as capable — see koluIdentityEnv's doc comment.
    expect(koluIdentityEnv("9.9.9").COLORTERM).toBe("truecolor");
  });

  it("VTE_VERSION stomps a parent value when layered via Object.assign", () => {
    // Pins the intentional behavior change from `??=` in cleanEnv to
    // unconditional assignment via koluIdentityEnv: kolu isn't a VTE
    // terminal, so inheriting a stale parent VTE_VERSION would be a
    // bigger lie than the hardcoded shim. Guards against a future
    // refactor that quietly reintroduces inheritance.
    const layered: Record<string, string> = { VTE_VERSION: "9999" };
    Object.assign(layered, koluIdentityEnv("9.9.9"));
    expect(layered.VTE_VERSION).toBe("7603");
  });
});

describe("cleanEnv — kolu's own KOLU_* namespace never reaches a hosted shell", () => {
  // Regression: a production kolu bakes KOLU_KAVAL_BIN (et al.) into its own
  // env via the nix wrapper. cleanEnv()'s production passthrough would forward
  // those into every PTY it spawns — so a nested `just dev` (from source, run
  // inside a kolu terminal) inherited a STALE KOLU_KAVAL_BIN and spawned a
  // contract-skewed kaval. cleanEnv must strip the KOLU_* namespace. Default
  // module state (no configureNixShellEnv call) is passthrough mode — the exact
  // production path that leaked.
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("strips KOLU_* (incl. the spawn-deciding KOLU_KAVAL_* vars), keeps the user's env", () => {
    process.env.KOLU_KAVAL_BIN = "/nix/store/stale-kaval/bin/kaval";
    process.env.KOLU_KAVAL_SOCKET = "/run/stale/pty-host.sock";
    process.env.KOLU_KAVAL_SPAWN = "detached";
    process.env.KOLU_STATE_DIR = "/home/x/.config/kolu";
    process.env.PTY_TEST_USER_VAR = "keep-me";

    const env = cleanEnv();

    // kolu's namespace is gone — nothing ancestral can ride it into the shell.
    expect(env.KOLU_KAVAL_BIN).toBeUndefined();
    expect(env.KOLU_KAVAL_SOCKET).toBeUndefined();
    expect(env.KOLU_KAVAL_SPAWN).toBeUndefined();
    expect(env.KOLU_STATE_DIR).toBeUndefined();
    expect(Object.keys(env).some((k) => k.startsWith("KOLU_"))).toBe(false);

    // the user's real environment is untouched.
    expect(env.PTY_TEST_USER_VAR).toBe("keep-me");
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("OSC7_FN", () => {
  it("emits OSC 7 with file:// URL containing hostname and cwd", () => {
    const out = runBash(`${OSC7_FN}; __kolu_osc7`, "/tmp");
    // Format: ESC ] 7 ; file://<hostname><pwd> ESC \
    // On macOS /tmp resolves to /private/tmp, so the path may end in
    // /tmp but contain /private as a prefix — accept any path ending
    // in /tmp.
    expect(out).toMatch(/^\x1b\]7;file:\/\/.+\/tmp\x1b\\$/);
  });

  it("reflects current PWD not the initial cwd", () => {
    const out = runBash(
      `${OSC7_FN}; cd /; __kolu_osc7; cd /tmp; __kolu_osc7`,
      "/tmp",
    );
    // First emission ends with /, second ends with /tmp
    const matches = [...out.matchAll(/file:\/\/[^/]+([^\x1b]*)/g)];
    expect(matches).toHaveLength(2);
    expect(matches[0]?.[1]).toBe("/");
    expect(matches[1]?.[1]).toBe("/tmp");
  });
});

describe("OSC2_PREEXEC_FN", () => {
  // __kolu_preexec emits TWO sequences per invocation:
  //   1. OSC 2 title change (for terminal title + event-driven reconcile)
  //   2. OSC 633 ; E ; <command>  (VS Code semantic command mark, for
  //      recent-agents MRU + per-terminal agent-command stash)
  // Order is NOT load-bearing — onCommandRun in terminals.ts publishes
  // its own reconcile trigger after stashing. See shell.ts docstring.

  it("emits OSC 2 with the passed command string", () => {
    const out = runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec "vim foo.ts"`);
    expect(out).toContain("\x1b]2;vim foo.ts\x1b\\");
  });

  it("emits OSC 633;E with the passed command string", () => {
    const out = runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec "vim foo.ts"`);
    expect(out).toContain("\x1b]633;E;vim foo.ts\x1b\\");
  });

  it("handles commands with special characters", () => {
    const out = runBash(
      `${OSC2_PREEXEC_FN}; __kolu_preexec 'grep "needle" file.txt'`,
    );
    expect(out).toContain('\x1b]2;grep "needle" file.txt\x1b\\');
    expect(out).toContain('\x1b]633;E;grep "needle" file.txt\x1b\\');
  });

  it("emits empty payload for empty command", () => {
    const out = runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec ""`);
    expect(out).toContain("\x1b]2;\x1b\\");
    expect(out).toContain("\x1b]633;E;\x1b\\");
  });
});

describe("OSC2_PRECMD_BASH", () => {
  it("emits OSC 2 with the current directory from dirs", () => {
    const out = runBash(`${OSC2_PRECMD_BASH}; __kolu_title_precmd`, "/tmp");
    // Format: ESC ] 2 ; <path> ESC \
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x1b\\$/);
    expect(out).toContain("tmp");
  });
});

describe("OSC2_PREEXEC_BASH_GUARD", () => {
  /** Common prelude that sets up preexec fn + guard. */
  const prelude = `${OSC2_PREEXEC_FN}\n${OSC2_PREEXEC_BASH_GUARD}\n`;

  it("arm sets the ready flag", () => {
    const out = runBash(
      `${prelude}__kolu_preexec_arm; printf 'ready=%s\\n' "$__kolu_preexec_ready" >&2`,
    );
    // stdout is empty (no OSC), stderr has ready=1 — but execFileSync only returns stdout.
    // Re-run capturing both streams:
    const combined = execFileSyncBoth(
      `${prelude}__kolu_preexec_arm; echo "ready=$__kolu_preexec_ready"`,
    );
    expect(combined).toContain("ready=1");
    expect(out).toBe("");
  });

  it("dispatch is no-op when ready flag is empty (no DEBUG trap installed)", () => {
    // Without arm(), dispatch should return immediately with no output
    const out = runBash(`${prelude}__kolu_preexec_dispatch; echo "done"`);
    // "done" is printed to stdout; the OSC 2 line should NOT appear
    expect(out).not.toContain("\x1b]2;");
    expect(out).toContain("done");
  });

  it("DEBUG trap emits for user command when armed via PS0", () => {
    // Real integration: install DEBUG trap + arm manually (PS0 simulated),
    // then run a no-op command. The trap fires with BASH_COMMAND set by bash itself.
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__kolu_preexec_arm\n` +
        `true\n`,
    );
    // The DEBUG trap fires for __kolu_preexec_arm itself BEFORE arm runs (flag is ""),
    // then for `true` after arm set flag=1 — so we should see ONE OSC 2 emission
    // with the command "true".
    const matches = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)];
    // At least one emission, and at least one should be "true"
    expect(matches.length).toBeGreaterThan(0);
    const titles = matches.map((m) => m[1]);
    expect(titles).toContain("true");
  });

  it("DEBUG trap does NOT emit when not armed (PROMPT_COMMAND simulation)", () => {
    // Simulate the state after a user command: ready flag was set, dispatch
    // was called, flag got cleared. Now a PROMPT_COMMAND hook runs — no arm,
    // flag stays "". Verify no OSC 2 is emitted.
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // No arm — simulates PROMPT_COMMAND context
        `__zoxide_hook() { :; }\n` +
        `__zoxide_hook\n`,
    );
    // The command "__zoxide_hook" would fire DEBUG with BASH_COMMAND="__zoxide_hook"
    // but flag is empty so dispatch returns early.
    expect(out).not.toContain("__zoxide_hook");
  });

  it("readline widget (fzf Ctrl+R) does not consume the ready flag", () => {
    // Regression: when fzf's Ctrl+R binding fires, BASH_COMMAND is set to
    // `__fzf_history__` — a readline widget, not a user command. Before
    // the `__*` guard, dispatch would clear the ready flag for it, causing
    // the user's NEXT real command to see flag="" and get silently dropped
    // (the "had to run it twice" bug).
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__fzf_history__() { :; }\n` +
        // Arm flag (as PROMPT_COMMAND would after the prompt draws)
        `__kolu_preexec_arm\n` +
        // Simulate Ctrl+R: widget runs, should NOT consume the flag
        `__fzf_history__\n` +
        // Now the user's real command — flag must still be armed
        `true\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // The widget should be skipped, the real command should fire.
    expect(titles).not.toContain("__fzf_history__");
    expect(titles).toContain("true");
  });

  it("full flow: user command emitted, PROMPT_COMMAND hook skipped", () => {
    // Most realistic test: install trap, simulate user command (arm + run),
    // then simulate PROMPT_COMMAND hook (no arm + run another command).
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__zoxide_hook() { :; }\n` +
        // Simulate user command via PS0 arm
        `__kolu_preexec_arm\n` +
        `true\n` +
        // After the user command, flag is cleared. Now PROMPT_COMMAND hooks run.
        `__zoxide_hook\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // "true" should appear (user command), "__zoxide_hook" should NOT
    expect(titles).toContain("true");
    expect(titles).not.toContain("__zoxide_hook");
  });

  // REGRESSION: PS0 command substitution runs in a subshell, so
  // `PS0='$(__kolu_preexec_arm)'` would set the flag in a subshell that
  // immediately exits — the parent shell's flag stays empty and dispatch
  // never emits. We now arm via PROMPT_COMMAND (end) instead.
  it("regression: arming via PS0 subshell does NOT work (wrong approach)", () => {
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // BAD: PS0 runs arm in a subshell, flag never reaches parent
        `PS0='$(__kolu_preexec_arm)'\n` +
        // Force PS0 evaluation by... actually, PS0 only fires in interactive
        // mode after readline reads a line. Non-interactive bash doesn't
        // evaluate PS0 at all. So we simulate the broken behavior by
        // running arm inside `$(...)` directly.
        `$(__kolu_preexec_arm)\n` +
        `true\n`,
    );
    // The subshell arm doesn't leak to parent → dispatch for `true` sees
    // flag="" → no emission.
    expect(out).not.toContain("\x1b]2;true");
  });

  it("correct approach: arming at end of PROMPT_COMMAND reaches parent", () => {
    // Simulate the real PROMPT_COMMAND cycle: arm runs as the last step of
    // PROMPT_COMMAND, which executes in the parent shell (no subshell).
    const out = runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // PROMPT_COMMAND = "...;__kolu_preexec_arm" (simplified to just arm)
        // In real bash this runs before each prompt; here we call it directly.
        `__kolu_preexec_arm\n` +
        // Now the user's command runs — DEBUG fires with flag=1 → emit
        `true\n` +
        // Next cycle: arm again, then another command
        `__kolu_preexec_arm\n` +
        `:\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // Both user commands should have emitted their OSC 2
    expect(titles).toContain("true");
    expect(titles).toContain(":");
  });
});

/** Like runBash but returns combined stdout+stderr. */
function execFileSyncBoth(script: string): string {
  try {
    return execFileSync("bash", ["-c", `${script} 2>&1`], {
      encoding: "utf8",
    });
  } catch {
    return "";
  }
}

/** The sole init file of a plan, asserted present (the bash/zsh wrappers always
 *  produce exactly one). Keeps the golden assertions free of index-access
 *  undefined-narrowing noise. */
function onlyInitFile(init: ReturnType<typeof prepareShellInit>): {
  name: string;
  content: string;
} {
  expect(init.initFiles).toHaveLength(1);
  const [file] = init.initFiles;
  if (!file) throw new Error("expected exactly one init file");
  return file;
}

/** Materialise a pure plan's init files under rcDir, the way the pty-host does
 *  on spawn — so a behavioral test can source the wrapper the host would run. */
function materialise(
  rcDir: string,
  init: ReturnType<typeof prepareShellInit>,
): void {
  for (const f of init.initFiles) {
    const p = join(rcDir, f.name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
}

describe("prepareShellInit — fully-specified plan (B0)", () => {
  // The golden parity guard: after the inversion `prepareShellInit` is PURE —
  // it plans the wrapper (argv + env + initFiles) but writes nothing; the
  // pty-host materialises the files on the disk it owns. These lock the exact
  // shape the host now relies on (paths into the host's rcDir, the bash/zsh
  // wrapper mechanism) so a refactor can't silently drift the spawn.

  it("bash: --rcfile points into rcDir, content is replay-then-hooks, nothing written", () => {
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    const id = "T-bash";
    const init = prepareShellInit({
      shell: "/bin/bash",
      home: "/home/x",
      terminalId: id,
      rcDir,
    });
    expect(init.args).toEqual(["--rcfile", join(rcDir, `bashrc-${id}`)]);
    expect(init.env).toEqual({});
    const file = onlyInitFile(init);
    expect(file.name).toBe(`bashrc-${id}`);
    // PURE: the planner touched no disk.
    expect(existsSync(join(rcDir, `bashrc-${id}`))).toBe(false);
    const content = file.content;
    // replay (user dotfiles) precedes hooks (OSC injection) — load-bearing.
    expect(content).toContain("/etc/profile"); // replay
    expect(content).toContain("/home/x/.bashrc"); // replay, against the given home
    expect(content).toContain(OSC7_FN); // hook
    expect(content.indexOf("/home/x/.bashrc")).toBeLessThan(
      content.indexOf(OSC7_FN),
    );
    rmSync(rcDir, { recursive: true, force: true });
  });

  it("zsh: ZDOTDIR points into rcDir, init file is <dir>/.zshrc, nothing written", () => {
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    const id = "T-zsh";
    const init = prepareShellInit({
      shell: "/bin/zsh",
      home: "/home/x",
      terminalId: id,
      rcDir,
    });
    expect(init.args).toEqual([]);
    expect(init.env.ZDOTDIR).toBe(join(rcDir, `zdotdir-${id}`));
    expect(onlyInitFile(init).name).toBe(join(`zdotdir-${id}`, ".zshrc"));
    expect(existsSync(join(rcDir, `zdotdir-${id}`))).toBe(false);
    rmSync(rcDir, { recursive: true, force: true });
  });

  it("returns an empty plan for an unknown shell or a missing home", () => {
    const empty = { args: [], env: {}, initFiles: [] };
    expect(
      prepareShellInit({
        shell: "/usr/bin/fish",
        home: "/home/x",
        terminalId: "x",
        rcDir: "/r",
      }),
    ).toEqual(empty);
    expect(
      prepareShellInit({
        shell: "/bin/bash",
        home: undefined,
        terminalId: "x",
        rcDir: "/r",
      }),
    ).toEqual(empty);
  });
});

describe("prepareShellInit zsh wrapper", () => {
  // Behavioral regression for #800: spawn zsh against the wrapper rcfile
  // with a fake ~/.zshenv that exports a marker, then verify the marker
  // survives. Stronger than a string-match on the generated rcfile —
  // catches the case where the source line is present but unreachable
  // (broken `if`, wrong path, accidentally inside a function, etc.).
  it("loads user env from ~/.zshenv (regression: missing under macOS launchd)", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "kolu-shell-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    try {
      writeFileSync(
        join(fakeHome, ".zshenv"),
        "export KOLU_TEST_MARKER=loaded\n",
      );
      const init = prepareShellInit({
        shell: "/bin/zsh",
        home: fakeHome,
        terminalId: `test-zshenv-${process.pid}`,
        rcDir,
      });
      // The pty-host writes the planned init files before spawn; do the same.
      materialise(rcDir, init);
      const rcPath = join(init.env.ZDOTDIR as string, ".zshrc");
      const out = runZsh(
        `source ${rcPath} >/dev/null 2>&1; printf '%s' "$KOLU_TEST_MARKER"`,
      );
      if (out === null) return; // zsh unavailable — skip
      expect(out).toBe("loaded");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(rcDir, { recursive: true, force: true });
    }
  });
});

describe("OSC2_PRECMD_ZSH", () => {
  it("emits OSC 2 with compact zsh prompt path", () => {
    const out = runZsh(`${OSC2_PRECMD_ZSH}; __kolu_title_precmd`, "/tmp");
    if (out === null) return; // zsh unavailable — skip
    // Format: ESC ] 2 ; <compact path> BEL
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x07$/);
    expect(out).toContain("tmp");
  });

  it("uses compact notation for deep paths", () => {
    // Build a deep path at runtime (>= 4 segments) so the ellipsis branch fires
    const out = runZsh(
      `mkdir -p /tmp/kolu-deep-test/a/b/c && ${OSC2_PRECMD_ZSH}; cd /tmp/kolu-deep-test/a/b/c && __kolu_title_precmd`,
    );
    if (out === null) return;
    // zsh %(4~|…/%3~|%~) — 5 segments (/tmp/kolu-deep-test/a/b/c) → …/a/b/c
    expect(out).toMatch(/^\x1b\]2;.*\x07$/);
    expect(out).toContain("a/b/c");
  });
});
