/**
 * Unit tests for shell.ts OSC injection functions.
 *
 * Tests the shell functions by executing them in a real bash/zsh subprocess
 * and asserting on the escape sequences they emit.
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
  OSC2_PREEXEC_BASH_GUARD,
  OSC2_PREEXEC_FN,
  OSC7_FN,
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
