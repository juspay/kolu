/**
 * Shell environment preparation for PTY spawning.
 *
 * Passes the server's env straight through to PTY shells and injects
 * OSC 7 CWD reporting hooks.  Nix devshell pollution is handled at
 * startup: the server refuses to start inside a nix shell unless
 * --allow-nix-shell-env is passed (used by `just dev` / `just test`).
 */

import { userInfo, tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/**
 * Crash if running inside a nix devshell without explicit opt-in.
 * Nix devshells pollute the env with NIX_*, DIRENV_*, derivation vars,
 * etc. that break user shells spawned by the PTY. Production deployments
 * (home-manager, nix run) have a clean env and don't hit this.
 */
export function rejectNixShellEnv(allowed: boolean): void {
  if (allowed || !process.env.IN_NIX_SHELL) return;
  console.error(
    "ERROR: kolu is running inside a nix shell.\n" +
      "The nix devshell env will leak into user terminals and break shell init.\n" +
      "Pass --allow-nix-shell-env to override (used by `just dev` / `just test`).",
  );
  process.exit(1);
}

/** Build env for the PTY shell — just process.env with VTE_VERSION ensured. */
export function cleanEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
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
