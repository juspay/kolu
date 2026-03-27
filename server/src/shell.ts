/**
 * Shell environment preparation for PTY spawning.
 *
 * Passes the server's env straight through to PTY shells and injects
 * OSC 7 CWD reporting hooks.  Nix devshell pollution is handled at
 * startup: the server refuses to start inside a nix shell unless
 * --allow-nix-shell-with-env-whitelist is passed (used by `just dev` /
 * `just test`).
 */

import { userInfo, tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/**
 * Env vars safe to forward from a nix devshell to PTY shells.
 * Everything else (NIX_*, DIRENV_*, derivation vars) is excluded.
 */
const NIX_ENV_WHITELIST = new Set([
  "HOME",
  "USER",
  "PATH",
  "TERM",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "DISPLAY",
  "COLORTERM",
  "TERM_PROGRAM",
]);

/** Whether to use the whitelist; set once at startup by configureNixShellEnv. */
let useEnvWhitelist = false;

/**
 * Configure nix shell env handling at startup.
 *
 * When enabled: cleanEnv() will only forward NIX_ENV_WHITELIST vars.
 * When disabled: crash if IN_NIX_SHELL is set (production safety net).
 */
export function configureNixShellEnv(enabled: boolean): void {
  if (enabled) {
    useEnvWhitelist = true;
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
 * Build env for the PTY shell.
 *
 * Without a whitelist (production): pass process.env straight through.
 * With a whitelist (dev/test inside nix shell): pick only whitelisted vars
 * and override SHELL with the user's login shell from /etc/passwd.
 */
export function cleanEnv(): Record<string, string> {
  let env: Record<string, string>;
  if (useEnvWhitelist) {
    env = {};
    for (const key of NIX_ENV_WHITELIST) {
      if (process.env[key] != null) env[key] = process.env[key]!;
    }
    // Nix sets SHELL to /nix/store/.../bash which lacks features like progcomp
    // that user bashrc files expect. Use the real login shell from /etc/passwd.
    env.SHELL = userInfo().shell || "/bin/sh";
  } else {
    env = { ...process.env } as Record<string, string>;
  }
  // Enable VTE integration in bash/zsh (some tools like direnv check this).
  env.VTE_VERSION ??= "7603";
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
  extraPath?: string,
): { args: string[]; env: Record<string, string>; cleanup: () => void } {
  const noop = { args: [], env: {}, cleanup: () => {} };
  if (!home) return noop;

  const isBash = shell.endsWith("/bash") || shell.endsWith("/bash5");
  const isZsh = shell.endsWith("/zsh");

  // Prepend extra dirs to PATH after the user's rc (which may rebuild PATH from scratch on NixOS).
  const pathLine = extraPath ? `export PATH="${extraPath}:$PATH"` : "";

  if (isBash) {
    const rcFile = join(tmpdir(), `kolu-bashrc-${process.pid}-${Date.now()}`);
    writeFileSync(
      rcFile,
      [
        `[ -f "${home}/.bashrc" ] && . "${home}/.bashrc"`,
        pathLine,
        OSC7_FN,
        `PROMPT_COMMAND="__kolu_osc7\${PROMPT_COMMAND:+;\$PROMPT_COMMAND}"`,
      ]
        .filter(Boolean)
        .join("\n"),
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
        pathLine,
        OSC7_FN,
        `autoload -Uz add-zsh-hook`,
        `add-zsh-hook precmd __kolu_osc7`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return {
      args: [],
      env: { ZDOTDIR: zdotdir },
      cleanup: () => rmSync(zdotdir, { recursive: true, force: true }),
    };
  }

  return noop;
}
