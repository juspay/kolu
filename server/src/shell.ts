/**
 * Shell environment preparation for PTY spawning.
 *
 * Builds a minimal, clean env that avoids nix/direnv pollution
 * leaking into the user's spawned shell.
 */

import { userInfo } from "node:os";

/** Env vars safe to forward to the PTY shell. */
const KEEP_ENV = [
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "DISPLAY",
  "COLORTERM",
  "TERM_PROGRAM",
] as const;

/**
 * Build a minimal env for the PTY shell.
 *
 * The server may run inside nix/direnv which pollutes the env with
 * NIX_*, DIRENV_*, BASH_ENV, etc. — these break the user's shell
 * (wrong PS1, shopt errors, direnv unloading). We only forward the
 * essentials so the spawned shell starts clean.
 */
export function cleanEnv(): Record<string, string> {
  const env = Object.fromEntries(
    KEEP_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
  );
  // nix devshells (via direnv/nix-direnv or nix develop) set SHELL to
  // /nix/store/.../bash-5.3 which removed the `progcomp` shopt option —
  // the user's .bashrc errors on `shopt -s progcomp`.
  // userInfo().shell reads from getpwuid(3) — the OS login shell, not $SHELL.
  if (env.SHELL?.startsWith("/nix/store")) {
    env.SHELL = userInfo().shell ?? "/bin/sh";
  }
  env.PATH = process.env.PATH ?? "/usr/bin:/bin";
  // Enable VTE integration in bash/zsh (some tools like direnv check this).
  env.VTE_VERSION = process.env.VTE_VERSION ?? "7603";
  return env;
}
