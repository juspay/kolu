/**
 * Shared shell init for Kolu-owned PTYs.
 *
 * The server's local PTY path and the SSH helper both need the same OSC
 * contract: OSC 7 for cwd, OSC 2 for foreground title, and OSC 633;E for the
 * exact command line. Keeping the wrapper generation here prevents local and
 * remote terminals from learning subtly different shell behavior.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Kolu's identity env vars, layered over the parent env by PTY spawners.
 *
 * `TERM_PROGRAM` follows the convention shared by VSCode, iTerm2, Ghostty,
 * WezTerm. `VTE_VERSION` is a compatibility shim for tools such as direnv.
 */
export function koluIdentityEnv(version: string): Record<string, string> {
  return {
    TERM_PROGRAM: "kolu",
    TERM_PROGRAM_VERSION: version,
    VTE_VERSION: "7603",
  };
}

/** Shell function that emits OSC 7 with the current working directory. */
export const OSC7_FN = `__kolu_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$PWD"; }`;

/** Shell function fired from preexec before each command. */
export const OSC2_PREEXEC_FN = `__kolu_preexec() { printf '\\033]2;%s\\033\\\\' "$1"; printf '\\033]633;E;%s\\033\\\\' "$1"; }`;

/** Bash-specific preexec dispatch guard. */
export const OSC2_PREEXEC_BASH_GUARD = [
  `__kolu_preexec_ready=""`,
  `__kolu_preexec_arm() { __kolu_preexec_ready="1"; }`,
  `__kolu_preexec_dispatch() {`,
  `  [ -z "$__kolu_preexec_ready" ] && return`,
  `  case "$BASH_COMMAND" in __*) return ;; esac`,
  `  __kolu_preexec_ready=""`,
  `  __kolu_preexec "$BASH_COMMAND"`,
  `}`,
].join("\n");

/** Shell function that resets OSC 2 title to CWD at the prompt. */
export const OSC2_PRECMD_BASH = `__kolu_title_precmd() { printf '\\033]2;%s\\033\\\\' "$(dirs +0)"; }`;
export const OSC2_PRECMD_ZSH = `__kolu_title_precmd() { print -Pn '\\e]2;%(4~|…/%3~|%~)\\a'; }`;

export type SpawnInit = {
  args: string[];
  env: Record<string, string>;
  cleanup: () => void;
};

type ShellInit = {
  replay: (home: string) => string[];
  hooks: string[];
  spawn: (
    rcContent: string,
    terminalId: string,
    shellInitDir: string,
  ) => SpawnInit;
};

const BASH_INIT: ShellInit = {
  replay: (home) => [
    `[ -f /etc/profile ] && . /etc/profile`,
    `__kolu_login=0; for __f in "${home}/.bash_profile" "${home}/.bash_login" "${home}/.profile"; do [ -f "$__f" ] && { . "$__f"; __kolu_login=1; break; }; done`,
    `[ "$__kolu_login" = 0 ] && [ -f "${home}/.bashrc" ] && . "${home}/.bashrc"`,
    `unset __kolu_login __f`,
  ],
  hooks: [
    OSC7_FN,
    OSC2_PREEXEC_FN,
    OSC2_PREEXEC_BASH_GUARD,
    OSC2_PRECMD_BASH,
    `PROMPT_COMMAND="__kolu_osc7;__kolu_title_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kolu_preexec_arm"`,
    `trap '__kolu_preexec_dispatch' DEBUG`,
  ],
  spawn: (rcContent, terminalId, shellInitDir) => {
    mkdirSync(shellInitDir, { recursive: true });
    const rcFile = join(shellInitDir, `bashrc-${terminalId}`);
    writeFileSync(rcFile, rcContent);
    return {
      args: ["--rcfile", rcFile],
      env: {},
      cleanup: () => rmSync(rcFile, { force: true }),
    };
  },
};

const ZSH_INIT: ShellInit = {
  replay: (home) => [
    `[ -f "${home}/.zshenv" ] && source "${home}/.zshenv"`,
    `[ -f /etc/zprofile ] && source /etc/zprofile`,
    `[ -f "${home}/.zprofile" ] && source "${home}/.zprofile"`,
    `[ -f "${home}/.zshrc" ] && ZDOTDIR="${home}" source "${home}/.zshrc"`,
  ],
  hooks: [
    OSC7_FN,
    OSC2_PREEXEC_FN,
    OSC2_PRECMD_ZSH,
    `autoload -Uz add-zsh-hook`,
    `add-zsh-hook precmd __kolu_osc7`,
    `add-zsh-hook precmd __kolu_title_precmd`,
    `add-zsh-hook preexec __kolu_preexec`,
  ],
  spawn: (rcContent, terminalId, shellInitDir) => {
    const zdotdir = join(shellInitDir, `zdotdir-${terminalId}`);
    mkdirSync(zdotdir, { recursive: true });
    writeFileSync(join(zdotdir, ".zshrc"), rcContent);
    return {
      args: [],
      env: { ZDOTDIR: zdotdir },
      cleanup: () => rmSync(zdotdir, { recursive: true, force: true }),
    };
  },
};

function selectShellInit(shell: string): ShellInit | null {
  if (shell.endsWith("/bash") || shell.endsWith("/bash5")) return BASH_INIT;
  if (shell.endsWith("/zsh")) return ZSH_INIT;
  return null;
}

export function prepareShellInit(opts: {
  shell: string;
  home: string | undefined;
  terminalId: string;
  shellInitDir: string;
}): SpawnInit {
  const noop: SpawnInit = { args: [], env: {}, cleanup: () => {} };
  const { shell, home, terminalId, shellInitDir } = opts;
  if (!home) return noop;
  const init = selectShellInit(shell);
  if (!init) return noop;
  const rcContent = [...init.replay(home), ...init.hooks].join("\n");
  return init.spawn(rcContent, terminalId, shellInitDir);
}
