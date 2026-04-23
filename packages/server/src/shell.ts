/**
 * Shell environment preparation for PTY spawning.
 *
 * Passes the server's env straight through to PTY shells and injects
 * OSC 7 CWD reporting hooks.  Nix devshell pollution is handled at
 * startup: the server refuses to start inside a nix shell unless
 * --allow-nix-shell-with-env-whitelist is passed (used by `just dev` /
 * `just test`).
 */

import { userInfo } from "node:os";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { koluShellDir } from "./koluRoot.ts";

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
  // Ensure SHELL is set — systemd user services may not have it.
  // Fall back to the login shell from /etc/passwd.
  env.SHELL ??= userInfo().shell || "/bin/sh";
  // Enable VTE integration in bash/zsh (some tools like direnv check this).
  env.VTE_VERSION ??= "7603";
  return env;
}

/** Shell function that emits OSC 7 with the current working directory. */
export const OSC7_FN = `__kolu_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$PWD"; }`;

/** Shell function fired from preexec before each command.
 *
 *  Emits TWO orthogonal sequences:
 *
 *  1. **OSC 633 ; E ; <cmd>** — VS Code's semantic "exact command line"
 *     mark. Consumed by the OSC 633 handler in pty.ts to build the
 *     global "recent agents" MRU and to stash the per-terminal
 *     agent-command hint on `TerminalProcess` (used to detect
 *     interpreter-shimmed agents like npm-installed codex, where the
 *     kernel-level process name is `node`). The shell hands us the
 *     command string verbatim, so kolu never needs `/proc` (Linux-only)
 *     or `ps` spawning (slow). Works identically on Linux and macOS.
 *
 *  2. **OSC 2** — window title. Mirrors Ghostty/Kitty convention of
 *     showing the running command in the title bar. Consumed by
 *     `headless.onTitleChange` in pty.ts to drive event-driven
 *     foreground process detection.
 *
 *  Order matters: 633;E fires FIRST so the stash is set before the
 *  title-triggered reconcile in `meta/agent.ts` reads it. */
export const OSC2_PREEXEC_FN = `__kolu_preexec() { printf '\\033]633;E;%s\\033\\\\' "$1"; printf '\\033]2;%s\\033\\\\' "$1"; }`;

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
 *  Readline widget guard: fzf's Ctrl+R / Ctrl+T bindings, bash-completion
 *  helpers, and zoxide's cd wrappers run via DEBUG trap with BASH_COMMAND
 *  set to a `__xxx` function name — they are NOT user-typed commands. If
 *  dispatch clears the ready flag for them, the user's next *real* command
 *  fires with flag="" and gets silently dropped. Skip anything starting
 *  with `__` without clearing the flag, so the next real command still
 *  dispatches. The `__` prefix is the strong bash convention for internal
 *  widgets; user commands virtually never use it.
 *
 *  (We originally tried PS0 command substitution, but `$(...)` runs in a
 *  subshell, so the flag assignment never reached the parent shell.) */
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

/** Shell function that resets OSC 2 title to CWD at the prompt.
 *  Matches Ghostty/Kitty convention: CWD when idle, command when running. */
export const OSC2_PRECMD_BASH = `__kolu_title_precmd() { printf '\\033]2;%s\\033\\\\' "$(dirs +0)"; }`;
export const OSC2_PRECMD_ZSH = `__kolu_title_precmd() { print -Pn '\\e]2;%(4~|…/%3~|%~)\\a'; }`;

/**
 * Prepare shell init that injects hooks *after* the user's login + rc files.
 *
 * The wrapper rc sources the login init chain (/etc/profile, ~/.bash_profile
 * or ~/.zprofile) followed by the interactive rc (~/.bashrc / ~/.zshrc), then
 * appends kolu's OSC hooks. This gives terminals the full PATH even when
 * the server runs as a systemd user service with a minimal environment.
 *
 * We can't just set PROMPT_COMMAND in env — tools like starship overwrite it.
 * The wrapper approach lets us append after all user init completes.
 *
 * Returns extra spawn args, env overrides, and a cleanup function to remove
 * any temp files created.
 */
export function osc7Init(opts: {
  shell: string;
  home: string | undefined;
  terminalId: string;
  extraPath?: string;
}): { args: string[]; env: Record<string, string>; cleanup: () => void } {
  const { shell, home, terminalId, extraPath } = opts;
  const noop = { args: [], env: {}, cleanup: () => {} };
  if (!home) return noop;

  const isBash = shell.endsWith("/bash") || shell.endsWith("/bash5");
  const isZsh = shell.endsWith("/zsh");

  // Prepend extra dirs to PATH after the user's rc (which may rebuild PATH from scratch on NixOS).
  const pathLine = extraPath ? `export PATH="${extraPath}:$PATH"` : "";

  if (isBash) {
    const rcFile = join(koluShellDir, `bashrc-${terminalId}`);
    writeFileSync(
      rcFile,
      [
        // Source login init chain so the shell inherits the full PATH
        // (e.g., from /etc/profile.d/hm-session-vars.sh on NixOS).
        // Mirrors bash login behavior: /etc/profile, then the first of
        // ~/.bash_profile / ~/.bash_login / ~/.profile.
        // If no login file exists, fall back to ~/.bashrc directly.
        `[ -f /etc/profile ] && . /etc/profile`,
        `__kolu_login=0; for __f in "${home}/.bash_profile" "${home}/.bash_login" "${home}/.profile"; do [ -f "$__f" ] && { . "$__f"; __kolu_login=1; break; }; done`,
        `[ "$__kolu_login" = 0 ] && [ -f "${home}/.bashrc" ] && . "${home}/.bashrc"`,
        `unset __kolu_login __f`,
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
    const zdotdir = join(koluShellDir, `zdotdir-${terminalId}`);
    mkdirSync(zdotdir, { recursive: true });
    writeFileSync(
      join(zdotdir, ".zshrc"),
      [
        `[ -f /etc/zprofile ] && source /etc/zprofile`,
        `[ -f "${home}/.zprofile" ] && source "${home}/.zprofile"`,
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
