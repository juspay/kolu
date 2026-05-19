/**
 * Shell environment preparation for PTY spawning.
 *
 * Two cooperating layers reach the spawned PTY:
 *   1. cleanEnv() — sanitizes the parent env passed to the PTY.
 *   2. prepareShellInit() — writes a wrapper rcfile that replays the shell's
 *      normal startup chain (which our --rcfile / ZDOTDIR override would
 *      otherwise suppress) and injects kolu's OSC hooks.
 *
 * The split matters under macOS launchd user agents, where the parent env
 * is near-empty and cleanEnv passthrough alone wouldn't carry a usable
 * PATH — the wrapper's replay step compensates by sourcing user dotfiles
 * directly. Linux/systemd masks this because PAM seeds the user-instance
 * env from the login session.
 *
 * Nix devshell pollution is handled at startup: the server refuses to run
 * inside a nix shell unless --allow-nix-shell-with-env-whitelist is passed
 * (used by `just dev` / `just test`).
 */

import { userInfo } from "node:os";
import { prepareShellInit as prepareSharedShellInit } from "kolu-shared/shell";
import { koluShellDir } from "./koluRoot.ts";

export {
  koluIdentityEnv,
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
  OSC2_PREEXEC_BASH_GUARD,
  OSC2_PREEXEC_FN,
  OSC7_FN,
  type SpawnInit,
} from "kolu-shared/shell";

/**
 * Default env vars safe to forward from a nix devshell to PTY shells.
 * Everything else (NIX_*, DIRENV_*, derivation vars) is excluded.
 * Exported so callers can pass it as the default whitelist value.
 *
 * Kolu's own identity vars (TERM_PROGRAM, TERM_PROGRAM_VERSION,
 * VTE_VERSION) live in `koluIdentityEnv()` and are layered on top of
 * cleanEnv's output by spawnPty — they don't belong in the parent-forward
 * whitelist.
 */
export const NIX_ENV_WHITELIST =
  "HOME,USER,PATH,TERM,LANG,LC_ALL,LOGNAME,DISPLAY,COLORTERM";

/** Whitelist set once at startup; undefined means passthrough mode (production). */
let envWhitelist: Set<string> | undefined;

/**
 * Configure nix shell env handling at startup.
 *
 * - "default"       → use NIX_ENV_WHITELIST
 * - "FOO,BAR,..."   → use custom whitelist
 * - undefined       → crash if IN_NIX_SHELL is set (production safety net)
 */
export function configureNixShellEnv(whitelist: string | undefined): void {
  if (whitelist != null) {
    const list = whitelist === "default" ? NIX_ENV_WHITELIST : whitelist;
    envWhitelist = new Set(list.split(",").filter(Boolean));
    return;
  }
  if (!process.env.IN_NIX_SHELL) return;
  console.error(
    "ERROR: kolu is running inside a nix shell.\n" +
      "The nix devshell env will leak into user terminals and break shell init.\n" +
      "Pass --allow-nix-shell-with-env-whitelist to override.",
  );
  process.exit(1);
}

/**
 * Sanitize the parent env that will reach the PTY shell.
 *
 * Without a whitelist (production): pass process.env straight through.
 * With a whitelist (dev/test inside nix shell): pick only whitelisted vars
 * and override SHELL with the user's login shell from /etc/passwd.
 *
 * Scope note: this layer only filters what the parent process exposes.
 * Restoring user env that the parent doesn't carry (e.g. PATH from
 * ~/.zshenv under macOS launchd) is the wrapper rcfile's job — see
 * prepareShellInit.
 */
export function cleanEnv(): Record<string, string> {
  let env: Record<string, string>;
  if (envWhitelist) {
    env = {};
    for (const key of envWhitelist) {
      const value = process.env[key];
      if (value != null) env[key] = value;
    }
    // Nix sets SHELL to /nix/store/.../bash which lacks features like progcomp
    // that user bashrc files expect. Use the real login shell from /etc/passwd.
    env.SHELL = userInfo().shell || "/bin/sh";
  } else {
    env = { ...process.env } as Record<string, string>;
  }
  // Ensure SHELL is set — systemd user services may not have it.
  // Fall back to the login shell from /etc/passwd.
  env.SHELL ??= userInfo().shell || "/bin/sh";
  return env;
}

/**
 * Build the wrapper rcfile for the user's shell and return the spawn args
 * + env override + cleanup that go alongside it.
 *
 * The wrapper layers two things in order: replay (user dotfiles the shell
 * would have auto-sourced) → hooks (kolu's OSC injection). The layering is
 * load-bearing — replay must precede hooks so user PROMPT_COMMAND / starship
 * etc. can't clobber our hooks. PROMPT_COMMAND in env doesn't work because
 * the user's rc would overwrite it.
 */
export function prepareShellInit(opts: {
  shell: string;
  home: string | undefined;
  terminalId: string;
}) {
  return prepareSharedShellInit({ ...opts, shellInitDir: koluShellDir });
}
