/**
 * Shell environment preparation for PTY spawning.
 *
 * Builds a minimal, clean env that avoids nix/direnv pollution
 * leaking into the user's spawned shell, and injects OSC 7 CWD
 * reporting hooks.
 */

import { userInfo, tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

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

/** Shell function that emits OSC 7 with the current working directory. */
const OSC7_FN = `__kolu_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$PWD"; }`;

/**
 * Prepare shell init that injects an OSC 7 hook *after* the user's rc files.
 *
 * We can't just set PROMPT_COMMAND in env — tools like starship overwrite it.
 * Instead we create a wrapper rc file that sources the user's config first,
 * then appends our hook to whatever PROMPT_COMMAND/precmd ended up being.
 *
 * Returns extra spawn args, env overrides, and a cleanup function to remove
 * any temp files created.
 */
export function osc7Init(
  shell: string,
  home: string | undefined,
): { args: string[]; env: Record<string, string>; cleanup: () => void } {
  const noop = { args: [], env: {}, cleanup: () => {} };
  if (!home) return noop;

  const isBash = shell.endsWith("/bash") || shell.endsWith("/bash5");
  const isZsh = shell.endsWith("/zsh");

  if (isBash) {
    const rcFile = join(tmpdir(), `kolu-bashrc-${process.pid}-${Date.now()}`);
    writeFileSync(
      rcFile,
      [
        `[ -f "${home}/.bashrc" ] && . "${home}/.bashrc"`,
        OSC7_FN,
        `PROMPT_COMMAND="__kolu_osc7\${PROMPT_COMMAND:+;\$PROMPT_COMMAND}"`,
      ].join("\n"),
    );
    return {
      args: ["--rcfile", rcFile],
      env: {},
      cleanup: () => rmSync(rcFile, { force: true }),
    };
  }

  if (isZsh) {
    const zdotdir = mkdtempSync(join(tmpdir(), "kolu-zsh-"));
    writeFileSync(
      join(zdotdir, ".zshrc"),
      [
        `[ -f "${home}/.zshrc" ] && ZDOTDIR="${home}" source "${home}/.zshrc"`,
        OSC7_FN,
        `autoload -Uz add-zsh-hook`,
        `add-zsh-hook precmd __kolu_osc7`,
      ].join("\n"),
    );
    return {
      args: [],
      env: { ZDOTDIR: zdotdir },
      cleanup: () => rmSync(zdotdir, { recursive: true, force: true }),
    };
  }

  return noop;
}
