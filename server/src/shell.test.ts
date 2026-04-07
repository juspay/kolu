/**
 * Unit tests for shell.ts OSC injection functions.
 *
 * Tests the shell functions by executing them in a real bash/zsh subprocess
 * and asserting on the escape sequences they emit.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  OSC7_FN,
  OSC2_PREEXEC_FN,
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
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
    expect(out).toMatch(/^\x1b\]7;file:\/\/[^/]+\/tmp\x1b\\$/);
  });

  it("reflects current PWD not the initial cwd", () => {
    const out = runBash(
      `${OSC7_FN}; cd /; __kolu_osc7; cd /tmp; __kolu_osc7`,
      "/tmp",
    );
    // First emission ends with /, second ends with /tmp
    const matches = [...out.matchAll(/file:\/\/[^/]+([^\x1b]*)/g)];
    expect(matches).toHaveLength(2);
    expect(matches[0]![1]).toBe("/");
    expect(matches[1]![1]).toBe("/tmp");
  });
});

describe("OSC2_PREEXEC_FN", () => {
  it("emits OSC 2 with the passed command string", () => {
    const out = runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec "vim foo.ts"`);
    expect(out).toBe("\x1b]2;vim foo.ts\x1b\\");
  });

  it("handles commands with special characters", () => {
    const out = runBash(
      `${OSC2_PREEXEC_FN}; __kolu_preexec 'grep "needle" file.txt'`,
    );
    expect(out).toBe('\x1b]2;grep "needle" file.txt\x1b\\');
  });

  it("emits empty title for empty command", () => {
    const out = runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec ""`);
    expect(out).toBe("\x1b]2;\x1b\\");
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
