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
import { join } from "node:path";

/**
 * Default env vars safe to forward from a nix devshell to PTY shells.
 * Everything else (NIX_*, DIRENV_*, derivation vars) is excluded.
 * Exported so callers can pass it as the default whitelist value.
 *
 * Kolu's own identity vars (TERM_PROGRAM, TERM_PROGRAM_VERSION,
 * VTE_VERSION, COLORTERM) live in `koluIdentityEnv()` and are layered on
 * top of cleanEnv's output by the PTY spawn caller — they don't belong in
 * the parent-forward whitelist.
 */
export const NIX_ENV_WHITELIST =
  "HOME,USER,PATH,TERM,LANG,LC_ALL,LOGNAME,DISPLAY";

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
 * Without a whitelist (production): pass process.env straight through, minus
 * kolu's own KOLU_* namespace (server-internal config that must never reach a
 * user shell — see the inline note in the passthrough branch).
 * With a whitelist (dev/test inside nix shell): pick only whitelisted vars
 * and override SHELL with the user's login shell from /etc/passwd.
 *
 * Scope note: this layer only filters what the parent process exposes.
 * Restoring user env that the parent doesn't carry (e.g. PATH from
 * ~/.zshenv under macOS launchd) is the wrapper rcfile's job — see
 * prepareShellInit.
 */
export function cleanEnv(): Record<string, string> {
  // Resolve the login shell once — used in both branches.
  const loginShell = userInfo().shell || "/bin/sh";
  let env: Record<string, string>;
  if (envWhitelist) {
    env = {};
    for (const key of envWhitelist) {
      const value = process.env[key];
      if (value != null) env[key] = value;
    }
    // Nix sets SHELL to /nix/store/.../bash which lacks features like progcomp
    // that user bashrc files expect. Use the real login shell from /etc/passwd.
    env.SHELL = loginShell;
  } else {
    env = { ...process.env } as Record<string, string>;
    // Don't forward kolu's own KOLU_* namespace into the user's shell. These
    // are the server's internal config (e.g. the wrapper-baked KOLU_KAVAL_BIN
    // that tells the server which kaval to spawn) — baked into the server's env,
    // never meant for a hosted terminal. Forwarded, they leak into every PTY
    // child: a nested from-source kolu (`just dev` run inside a kolu terminal)
    // inherits a STALE KOLU_KAVAL_BIN and spawns a contract-skewed daemon. kolu
    // owns this prefix, so stripping it here — at the leak boundary — can't drop
    // a var a user shell legitimately needs (and a user-defined KOLU_* set in
    // their own dotfiles is re-applied by the rcfile replay, see prepareShellInit).
    for (const key of Object.keys(env)) {
      if (key.startsWith("KOLU_")) delete env[key];
    }
    // Ensure SHELL is set — systemd user services may not have it.
    env.SHELL ??= loginShell;
  }
  return env;
}

/**
 * Kolu's identity env vars, layered over `cleanEnv()` by the PTY spawn
 * caller.
 *
 * Separate function because the volatility axis is different: cleanEnv
 * decides what parent vars are safe to forward (driven by Nix devshell
 * pollution, OS conventions); koluIdentityEnv decides what Kolu asserts
 * about itself (driven by rebrand, version bumps, future capability vars).
 *
 * `TERM_PROGRAM` follows the convention shared by VSCode, iTerm2,
 * Ghostty, WezTerm — set by the terminal emulator/host so tools like
 * starship prompts and shell themes can detect their environment.
 *
 * `VTE_VERSION` is a compatibility shim some tools (e.g. direnv) check
 * for VTE-style integration; it sits here, not in cleanEnv, because it's
 * the same shape as the identity assertions. The value `7603` encodes VTE
 * 0.76.3 using VTE's scheme: major×10000 + minor×100 + micro.
 *
 * `COLORTERM=truecolor` advertises 24-bit color so tools gate their
 * truecolor escapes on it (Claude Code, vim, bat, delta). Our xterm.js
 * WebGL renderer displays 24-bit color faithfully, so the assertion is
 * honest. It belongs here, not in cleanEnv's passthrough whitelist: the
 * capability is a property of kolu's renderer, not of whatever env the
 * parent process happened to inherit — a GUI/launchd launch carries no
 * COLORTERM to forward, yet the renderer is just as capable.
 *
 * Per-PTY identity vars (anything that depends on terminalId) belong in
 * `SpawnInit.env` returned by `prepareShellInit`, not here.
 */
export function koluIdentityEnv(version: string): Record<string, string> {
  return {
    TERM_PROGRAM: "kolu",
    TERM_PROGRAM_VERSION: version,
    VTE_VERSION: "7603",
    COLORTERM: "truecolor",
  };
}

/** Shell function that emits OSC 7 with the current working directory. */
export const OSC7_FN = `__kolu_osc7() { printf '\\033]7;file://%s%s\\033\\\\' "$(hostname)" "$PWD"; }`;

/** Shell function fired from preexec before each command.
 *
 *  Emits TWO orthogonal sequences:
 *
 *  1. **OSC 2** — window title. Mirrors Ghostty/Kitty convention of
 *     showing the running command in the title bar. Consumed by
 *     `headless.onTitleChange` in `kaval` to drive event-driven
 *     foreground process detection.
 *
 *  2. **OSC 633 ; E ; <cmd>** — VS Code's semantic "exact command line"
 *     mark. The OSC 633 handler in `kaval` republishes the raw
 *     payload on the `commandRun` channel; downstream consumers derive the global
 *     "recent agents" MRU and a per-terminal agent-command stash (used to
 *     detect interpreter-shimmed agents like npm-installed codex, where
 *     the kernel-level process name is `node`). The shell hands us the
 *     command string verbatim, so callers never need `/proc` (Linux-only)
 *     or `ps` spawning (slow). Works identically on Linux and macOS.
 *
 *  Emission order is not load-bearing. Preexec fires while the shell is
 *  still at its prompt, so any reconcile triggered here would be gated
 *  out by `shellIdle` in the downstream snapshot anyway — the agent
 *  match actually fires once the agent has taken over the foreground
 *  and emits a later signal (WAL write for codex, TUI OSC 2 title). */
export const OSC2_PREEXEC_FN = `__kolu_preexec() { printf '\\033]2;%s\\033\\\\' "$1"; printf '\\033]633;E;%s\\033\\\\' "$1"; }`;

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

/** A wrapper rcfile the host must materialise before the shell starts, named
 *  relative to the host's `rcDir`. `prepareShellInit` only *plans* these — it
 *  computes name + content but writes nothing; the pty-host writes them under
 *  its own `rcDir` (the disk it owns, possibly on a remote machine) and removes
 *  them when the PTY exits. */
export type InitFile = { name: string; content: string };

/** The spawn plan for one PTY: the shell `args`, an `env` override, and the
 *  wrapper rcfiles to materialise. Pure data — no side effects, no cleanup
 *  callback (the host owns the files' lifetime). */
export type ShellInitPlan = {
  args: string[];
  env: Record<string, string>;
  initFiles: InitFile[];
};

/**
 * Per-shell wrapper-rc strategy.
 *
 * Two volatility axes are separated here so neither hides regressions in
 * the other:
 *
 *   - **replay**: the user dotfiles the shell would have auto-sourced if
 *     our wrapper override didn't suppress the lookup. New entries land
 *     here when shell startup semantics change (e.g. zsh's ~/.zshenv
 *     gap, fixed in #800). Anything missing is silently stripped from
 *     PTY shells whenever the parent env is empty.
 *
 *   - **hooks**: OSC injection script lines. Conceptually the same goal
 *     across shells but expressed differently (bash DEBUG trap vs zsh
 *     add-zsh-hook), so the lists aren't merge-able.
 *
 * The wrapper *mechanism* (--rcfile vs ZDOTDIR) is encapsulated in `plan`,
 * which names the assembled rcContent under `rcDir` and returns spawn args +
 * env override + the init-file specs. It writes nothing — the pty-host
 * materialises the files on the disk it owns.
 */
type ShellInit = {
  replay: (home: string) => string[];
  hooks: string[];
  plan: (rcContent: string, terminalId: string, rcDir: string) => ShellInitPlan;
};

const BASH_INIT: ShellInit = {
  replay: (home) => [
    // /etc/profile pulls in distro-wide additions (e.g. NixOS sources
    // /etc/profile.d/hm-session-vars.sh, which sets PATH).
    `[ -f /etc/profile ] && . /etc/profile`,
    // Bash login priority: first existing of these wins. Mirrors bash's
    // own login-shell semantics — only one of the three is sourced.
    `__kolu_login=0; for __f in "${home}/.bash_profile" "${home}/.bash_login" "${home}/.profile"; do [ -f "$__f" ] && { . "$__f"; __kolu_login=1; break; }; done`,
    // Fallback to interactive rc if no login file matched.
    `[ "$__kolu_login" = 0 ] && [ -f "${home}/.bashrc" ] && . "${home}/.bashrc"`,
    `unset __kolu_login __f`,
  ],
  hooks: [
    OSC7_FN,
    OSC2_PREEXEC_FN,
    OSC2_PREEXEC_BASH_GUARD,
    OSC2_PRECMD_BASH,
    // PROMPT_COMMAND order: our hooks first, user's after, arm last —
    // so the DEBUG ready flag only goes "on" between prompt setup and
    // the next user command (filters out PROMPT_COMMAND-internal hooks).
    `PROMPT_COMMAND="__kolu_osc7;__kolu_title_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kolu_preexec_arm"`,
    // DEBUG trap persists across commands, so install once at source time.
    `trap '__kolu_preexec_dispatch' DEBUG`,
  ],
  plan: (rcContent, terminalId, rcDir) => {
    const name = `bashrc-${terminalId}`;
    return {
      args: ["--rcfile", join(rcDir, name)],
      env: {},
      initFiles: [{ name, content: rcContent }],
    };
  },
};

const ZSH_INIT: ShellInit = {
  replay: (home) => [
    // Order matches zsh's natural startup order: zshenv → zprofile → zshrc.
    // ZDOTDIR override (in spawn below) shadows zsh's auto-lookup of each
    // of these, so we replay them by absolute path.
    `[ -f "${home}/.zshenv" ] && source "${home}/.zshenv"`,
    `[ -f /etc/zprofile ] && source /etc/zprofile`,
    `[ -f "${home}/.zprofile" ] && source "${home}/.zprofile"`,
    // Reset ZDOTDIR while sourcing the user's .zshrc so any internal
    // ZDOTDIR-relative lookups (plugin managers, completion dirs) hit
    // the real home rather than our wrapper temp dir.
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
  plan: (rcContent, terminalId, rcDir) => {
    const dir = `zdotdir-${terminalId}`;
    return {
      args: [],
      env: { ZDOTDIR: join(rcDir, dir) },
      initFiles: [{ name: join(dir, ".zshrc"), content: rcContent }],
    };
  },
};

function selectShellInit(shell: string): ShellInit | null {
  if (shell.endsWith("/bash") || shell.endsWith("/bash5")) return BASH_INIT;
  if (shell.endsWith("/zsh")) return ZSH_INIT;
  return null;
}

/**
 * Plan the wrapper rcfile for the user's shell: return the spawn args + env
 * override + the init-file specs that go alongside it. **Pure** — it writes
 * nothing. The pty-host materialises the returned `initFiles` under its own
 * `rcDir` and removes them when the PTY exits.
 *
 * The wrapper layers two things in order: replay (user dotfiles the shell
 * would have auto-sourced) → hooks (kolu's OSC injection). The layering is
 * load-bearing — replay must precede hooks so user PROMPT_COMMAND / starship
 * etc. can't clobber our hooks. PROMPT_COMMAND in env doesn't work because
 * the user's rc would overwrite it.
 *
 * `rcDir` is the *host's* directory where the per-terminal bashrc / ZDOTDIR
 * will be written — passed in (from the host's `system.info`) so the returned
 * `args`/`env` can point at the resolved paths even when the host is a
 * different machine than the one planning the spawn.
 */
export function prepareShellInit(opts: {
  shell: string;
  home: string | undefined;
  terminalId: string;
  rcDir: string;
}): ShellInitPlan {
  const noop: ShellInitPlan = { args: [], env: {}, initFiles: [] };
  const { shell, home, terminalId, rcDir } = opts;
  if (!home) return noop;
  const init = selectShellInit(shell);
  if (!init) return noop;
  const rcContent = [...init.replay(home), ...init.hooks].join("\n");
  return init.plan(rcContent, terminalId, rcDir);
}
