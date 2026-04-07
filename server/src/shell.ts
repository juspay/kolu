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
 * Default env vars safe to forward from a nix devshell to PTY shells.
 * Everything else (NIX_*, DIRENV_*, derivation vars) is excluded.
 * Exported so callers can pass it as the default whitelist value.
 */
export const NIX_ENV_WHITELIST =
  "HOME,USER,PATH,TERM,LANG,LC_ALL,LOGNAME,DISPLAY,COLORTERM,TERM_PROGRAM";

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
 * Build env for the PTY shell.
 *
 * Without a whitelist (production): pass process.env straight through.
 * With a whitelist (dev/test inside nix shell): pick only whitelisted vars
 * and override SHELL with the user's login shell from /etc/passwd.
 */
export function cleanEnv(): Record<string, string> {
  let env: Record<string, string>;
  if (envWhitelist) {
    env = {};
    for (const key of envWhitelist) {
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
export const OSC7_FN = `__kolu_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$PWD"; }`;

/** Shell function that emits OSC 2 (title) with the command about to run.
 *  Triggered by preexec — fires before each command, enabling event-driven
 *  foreground process detection without polling. */
export const OSC2_PREEXEC_FN = `__kolu_preexec() { printf '\\033]2;%s\\033\\\\' "$1"; }`;

/** Bash-specific preexec dispatch — uses a ready flag armed at the end of
 *  PROMPT_COMMAND to ensure the title only fires for user-typed commands,
 *  not PROMPT_COMMAND hooks themselves.
 *
 *  Why: bash's DEBUG trap fires for EVERY command including those inside
 *  PROMPT_COMMAND. Without a guard, hooks like __zoxide_hook, _direnv_hook,
 *  __fzf_history__ leak into OSC 2 and clutter the terminal title.
 *
 *  How: `__kolu_preexec_arm` is appended as the LAST entry in PROMPT_COMMAND,
 *  so the flag goes "ready" only between the end of PROMPT_COMMAND and the
 *  next user command. DEBUG dispatch checks the flag, emits once per user
 *  command, and clears it (so subsequent pipeline commands don't re-emit).
 *
 *  (We originally tried PS0 command substitution, but `$(...)` runs in a
 *  subshell, so the flag assignment never reached the parent shell.) */
export const OSC2_PREEXEC_BASH_GUARD = [
  `__kolu_preexec_ready=""`,
  `__kolu_preexec_arm() { __kolu_preexec_ready="1"; }`,
  `__kolu_preexec_dispatch() {`,
  `  [ -z "$__kolu_preexec_ready" ] && return`,
  `  __kolu_preexec_ready=""`,
  `  __kolu_preexec "$BASH_COMMAND"`,
  `}`,
].join("\n");

/** Shell function that resets OSC 2 title to CWD at the prompt.
 *  Matches Ghostty/Kitty convention: CWD when idle, command when running. */
export const OSC2_PRECMD_BASH = `__kolu_title_precmd() { printf '\\033]2;%s\\033\\\\' "$(dirs +0)"; }`;
export const OSC2_PRECMD_ZSH = `__kolu_title_precmd() { print -Pn '\\e]2;%(4~|…/%3~|%~)\\a'; }`;

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
        OSC2_PREEXEC_FN,
        OSC2_PREEXEC_BASH_GUARD,
        OSC2_PRECMD_BASH,
        // PROMPT_COMMAND order matters:
        //   1. Our own osc7 + title_precmd (title/CWD)
        //   2. User's PROMPT_COMMAND (if any)
        //   3. __kolu_preexec_arm — MUST be last, so the ready flag only goes
        //      "on" between the end of prompt setup and the next user command.
        //      Any DEBUG firing before arm (hooks, aliases, etc.) sees flag=""
        //      and skips emitting OSC 2.
        `PROMPT_COMMAND="__kolu_osc7;__kolu_title_precmd\${PROMPT_COMMAND:+;\$PROMPT_COMMAND};__kolu_preexec_arm"`,
        // Install the DEBUG trap at source time — reinstalling inside
        // PROMPT_COMMAND is unnecessary since the trap persists across
        // commands. If a user's .bashrc clears it, bash-preexec-compatible
        // setups will still work if we're loaded first.
        `trap '__kolu_preexec_dispatch' DEBUG`,
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
        OSC2_PREEXEC_FN,
        OSC2_PRECMD_ZSH,
        `autoload -Uz add-zsh-hook`,
        `add-zsh-hook precmd __kolu_osc7`,
        `add-zsh-hook precmd __kolu_title_precmd`,
        `add-zsh-hook preexec __kolu_preexec`,
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
