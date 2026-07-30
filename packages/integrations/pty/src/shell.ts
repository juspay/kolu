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
 * is near-empty and cleanEnv's canonical-allowlist composition alone wouldn't
 * carry a usable PATH — the wrapper's replay step compensates by sourcing user
 * dotfiles directly. Linux/systemd masks this because PAM seeds the user-instance
 * env from the login session.
 *
 * Nix devshell pollution is handled at startup: the server refuses to run
 * inside a nix shell unless --allow-nix-shell-with-env-whitelist is passed
 * (used by `just dev` / `just test`).
 */

import { userInfo } from "node:os";
import { join } from "node:path";

/**
 * The DEFAULT dev/nix-shell whitelist, layered ADDITIVELY on top of the canonical
 * {@link SPAWN_ENV_ALLOWLIST} base (see `cleanEnv`) — NOT a replacement. Note every one
 * of its keys is ALREADY in that base (HOME/USER/PATH/LOGNAME → FUNCTIONAL, TERM/LANG/
 * LC_ALL → PRESENTATION, DISPLAY → OPERATIONAL), so this default widens the base with
 * *nothing* — it exists as the harmless compat default. The whitelist MECHANISM earns its
 * keep as the CUSTOMIZATION seam: a caller passes MORE keys to admit genuinely-extra dev
 * vars the base drops (e.g. the e2e harness extends it with `GIT_AUTHOR_*`). Everything
 * unnamed (NIX_*, DIRENV_*, derivation vars) is excluded. Exported so callers can build on it.
 *
 * Kolu's own identity vars (TERM_PROGRAM, TERM_PROGRAM_VERSION,
 * VTE_VERSION, COLORTERM) live in `koluIdentityEnv()` and are layered on
 * top of cleanEnv's output by the PTY spawn caller — they don't belong in
 * the parent-forward whitelist.
 */
export const NIX_ENV_WHITELIST =
  "HOME,USER,PATH,TERM,LANG,LC_ALL,LOGNAME,DISPLAY";

// The ONE canonical allowlist of env keys safe to carry into a kolu-spawned process,
// composed from THREE named classes so a future addition must name a class it belongs
// to — and an identity-ish key has no class to claim. It is an ALLOWLIST, not a
// blacklist: a key NOT named here is DROPPED, so an identity var that doesn't exist yet
// (a future agent's `CLAUDE_CODE_CHILD_SESSION` kin, an orchestrator's private marker)
// cannot ride ambient env into any kolu-spawned process (the #1872 class). The line is
// not "narrow for its own sake" — it is "no ambient IDENTITY, finite, pinned"; a
// non-identity CAPABILITY var the user's login session owns is in-scope.

/** Class 1 — FUNCTIONAL base: what a shell or daemon needs to run at all. */
export const SPAWN_ENV_FUNCTIONAL = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "SHELL",
] as const;

/** Class 2 — PRESENTATION: describes the *terminal* (colour, locale), never identity.
 *  Named separately so a composer that reads functional vars from a different source (a
 *  remote host's `system.info`) can still carry presentation from the local terminal.
 *  The full POSIX locale-category set is carried, not just `LANG`/`LC_ALL`: a user who
 *  sets an individual category (`LC_TIME`, `LC_MESSAGES`, …) without `LC_ALL` would
 *  otherwise silently lose it, so date/number/message formatting drifts in the PTY. */
export const SPAWN_ENV_PRESENTATION = [
  "TERM",
  "COLORTERM",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_TIME",
  "LC_NUMERIC",
  "LC_COLLATE",
  "LC_MONETARY",
] as const;

/** Class 3 — OPERATIONAL-SESSION: capability vars MINTED BY THE USER'S LOGIN SESSION
 *  (PAM / systemd-user / launchd), NOT by dotfiles — so the wrapper rcfile replay
 *  cannot restore them, and dropping them silently breaks an interactive terminal
 *  (ssh-agent git push, `systemctl --user`, GUI apps, desktop notifications). All are
 *  non-identity CAPABILITY vars, so carrying them honors the invariant.
 *   - `TMPDIR` is load-bearing on DARWIN: launchd mints a per-user `/var/folders/…`
 *     temp dir per login session; narrowing it out silently falls every macOS tool
 *     back to `/tmp`.
 *   - `SSH_AGENT_PID` is deliberately OUT: `SSH_AUTH_SOCK` grants *signing* capability
 *     (a terminal workload needs it); `SSH_AGENT_PID` grants *kill-the-agent*
 *     capability, which no terminal workload needs — smaller is honest. */
export const SPAWN_ENV_OPERATIONAL = [
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "SSH_AUTH_SOCK",
  // The GUI-session display group, all minted by the login session: `DISPLAY` (X11)
  // is a session capability like its Wayland sibling, NOT a "run at all" functional
  // var — a shell runs fine without it — so it lives here, not in FUNCTIONAL.
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "TMPDIR",
] as const;

/** The single source of truth every composer funnels through: `cleanEnv` (below, for
 *  every hosted PTY shell), kaval-tui's `create`, padi's `daemonEnv`, and the e2e
 *  harness. A caller that genuinely needs a var outside all three classes adds it back
 *  EXPLICITLY (kaval-tui's `--env K=V`); there is no inherit-everything switch. Pinned
 *  exactly as data (`shell.test.ts`), grouped by class, so a widen is a reviewed,
 *  test-visible act. */
export const SPAWN_ENV_ALLOWLIST = [
  ...SPAWN_ENV_FUNCTIONAL,
  ...SPAWN_ENV_PRESENTATION,
  ...SPAWN_ENV_OPERATIONAL,
] as const;

/**
 * The atomic env-mining primitive: pick a fixed set of `keys` out of an env
 * `source`, keeping only the defined ones. Every kolu env composer is one binding
 * of this — the allowlist base ({@link composeSpawnEnv}), the nix-devshell
 * whitelist ({@link cleanEnv}), the remote presentation carry (`create.ts`) — so a
 * future refinement to the mining rule lands in ONE place and can't drift across
 * the three sites that used to inline the loop.
 */
export function pickEnv(
  keys: Iterable<string>,
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  // Null-prototype so a key literally named `__proto__` (a caller's `--env __proto__=…`
  // layered on top downstream) is a real data property, never a prototype mutation.
  const env: Record<string, string> = Object.create(null);
  for (const key of keys) {
    const value = source[key];
    if (value != null) env[key] = value;
  }
  return env;
}

/**
 * Compose a clean env by mining `source` for ONLY the {@link SPAWN_ENV_ALLOWLIST}
 * keys (defined — an empty string is a real value, kept, since unset vs empty is a
 * distinction downstream tools rely on, especially locale vars). The shared
 * primitive behind every kolu spawn composer,
 * so none can drift from the others: identity/secret vars outside the allowlist are
 * dropped by construction. Callers layer their own explicit additions and stamps on
 * top of the result.
 */
export function composeSpawnEnv(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  return pickEnv(SPAWN_ENV_ALLOWLIST, source);
}

/** Set once at startup. `undefined` (production) means compose from the canonical
 *  SPAWN_ENV_ALLOWLIST; a set value is the dev/nix-shell WIDENING of that base. */
let envWhitelist: Set<string> | undefined;

/**
 * Kolu-family internal env that the nix wrapper bakes into the SERVER's own
 * process (see `default.nix`'s `koluBin` / `default` `--set`s) and that must
 * never reach a hosted shell. Two groups, both server-internal:
 *
 *   - `KOLU_*` — the server's own config (`KOLU_KAVAL_BIN`, `KOLU_STATE_DIR`,
 *     `KOLU_COMMIT_HASH`, …). `KOLU_KAVAL_BIN` is the spawn-deciding one: a
 *     nested from-source kolu that inherits a stale value spawns a
 *     contract-skewed daemon.
 *   - `KAVAL_BUILD_ID` / `KAVAL_COMMIT_HASH` — the running kaval's *identity*,
 *     baked onto the kolu wrapper (default.nix:336-337) because kaval runs
 *     in-process there. `buildId.ts` reads these to derive the "update
 *     pending" / staleKey signal. A from-source kolu spawned inside a
 *     production kolu terminal would otherwise inherit the OUTER production
 *     identity and report the wrong build (masking the stale-daemon nudge) —
 *     the same wrapper-baked-env leak as `KOLU_*`, one prefix over.
 *
 * Note this is NOT the `KAVAL_*` namespace wholesale: a user could legitimately
 * have their own `KAVAL_*` env, and `SURFACE_AGENT_FLAKE_REF` (kaval-tui) is a
 * different concern. Only the two identity vars the kolu wrapper bakes are
 * internal, so they're listed explicitly rather than matched by prefix.
 */
const KOLU_INTERNAL_ENV_EXACT = new Set([
  "KAVAL_BUILD_ID",
  "KAVAL_COMMIT_HASH",
]);

/** True for any env key the kolu nix wrapper bakes into the server for its own
 *  use — the `KOLU_*` namespace plus the two baked kaval identity vars. These
 *  are stripped at the `cleanEnv` boundary so none ride into a hosted shell. */
function isKoluInternalEnvKey(key: string): boolean {
  return key.startsWith("KOLU_") || KOLU_INTERNAL_ENV_EXACT.has(key);
}

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
 * Without a whitelist (production): compose from {@link SPAWN_ENV_ALLOWLIST} — a
 * clean canonical base, NOT the whole parent env. This is the #1872 fix: the
 * daemon's env can carry leaked identity vars, and forwarding it wholesale leaked
 * them into every hosted PTY.
 * With a whitelist (dev/test inside nix shell): compose the SAME canonical base,
 * then ADDITIVELY widen it with the whitelisted nix-devshell vars, and override
 * SHELL with the user's login shell from /etc/passwd. The whitelist widens the
 * base, it does not replace it — so dev never gets a narrower env than production.
 *
 * Either way, shared post-steps run for both branches, so their invariants hold
 * independent of how env was built: strip kolu's own internal env (the `KOLU_*`
 * namespace plus the wrapper-baked kaval identity vars — see
 * `isKoluInternalEnvKey`), then drop empty `PATH` entries, which POSIX reads as
 * "the current directory". This is the ONE place that sanitizes a PATH; the
 * prepend rule (`prependPathEntries` / `PATH_REASSERT`) deliberately does not.
 * See the inline notes above each step.
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
    // Dev/test inside a nix devshell: start from the SAME canonical allowlist base
    // production composes — so the OPERATIONAL login-session vars (XDG_RUNTIME_DIR,
    // SSH_AUTH_SOCK, WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS, TMPDIR) are present
    // in dev too, matching production and the class's own rationale (dropping them
    // silently breaks an interactive terminal). Then ADDITIVELY widen with the
    // nix-devshell vars the whitelist names, on top. The whitelist is a dev-only
    // WIDENING, not a replacement, so a developer running `just dev` never silently
    // gets a narrower env than production.
    env = composeSpawnEnv(process.env);
    Object.assign(env, pickEnv(envWhitelist, process.env));
    // Nix sets SHELL to /nix/store/.../bash which lacks features like progcomp
    // that user bashrc files expect. Use the real login shell from /etc/passwd.
    env.SHELL = loginShell;
  } else {
    // Production: compose from the shared SPAWN_ENV_ALLOWLIST — NOT a wholesale
    // `{...process.env}` copy. The daemon's own process env can carry an
    // orchestrator's leaked identity vars (CLAUDE_CODE_CHILD_SESSION and kin,
    // #1872) or any other ambient marker; forwarding it verbatim leaked those into
    // EVERY hosted PTY. Composing from the allowlist closes the whole class in one
    // move — an unknown future identity var is dropped by construction. The wrapper
    // rcfile replay (prepareShellInit) re-sources the user's dotfiles, so their
    // real shell env is restored and the wholesale passthrough was never
    // load-bearing (holds even under the macOS launchd near-empty parent env).
    env = composeSpawnEnv(process.env);
    // Ensure SHELL is set — systemd user services may not have it, and it may be
    // absent from the allowlist mine above.
    env.SHELL ??= loginShell;
  }
  // Don't forward kolu's own internal env into the user's shell. The nix
  // wrapper bakes these into the SERVER's process for its own use (e.g.
  // KOLU_KAVAL_BIN, which tells the server which kaval to spawn, and the kaval
  // identity vars KAVAL_BUILD_ID / KAVAL_COMMIT_HASH that buildId.ts reads to
  // derive the "update pending" signal) — never meant for a hosted terminal.
  // Forwarded, they leak into every PTY child: a nested from-source kolu
  // (`just dev` run inside a kolu terminal) inherits a STALE KOLU_KAVAL_BIN and
  // spawns a contract-skewed daemon, and inherits the OUTER kaval identity so
  // its staleness readout reports the wrong build. kolu owns this env, so
  // stripping it here — at the leak boundary — can't drop a var a user shell
  // legitimately needs (and a user-defined KOLU_* set in their own dotfiles is
  // re-applied by the rcfile replay, see prepareShellInit). One shared strip
  // for both branches: the invariant is a property of cleanEnv, not of one
  // branch (and independent of NIX_ENV_WHITELIST's future contents).
  env = Object.fromEntries(
    Object.entries(env).filter(([k]) => !isKoluInternalEnvKey(k)),
  );
  // Drop empty entries from PATH. An empty entry ("/usr/bin::/bin", a leading or
  // trailing ":") is not cosmetic — POSIX reads it as "the current directory", so
  // every hosted shell would resolve commands out of whatever tree the user
  // happens to have cd'd into. For a terminal we host and hand to an agent that is
  // a real hazard, and the daemon's own inherited PATH is the one place we can fix
  // it for everyone downstream.
  //
  // It lives HERE because this is the env-sanitization boundary: it happens once,
  // on the way in, over the composed value. The alternative is every downstream
  // transform re-implementing it — specifically `prependPathEntries` and
  // `PATH_REASSERT`, the same rule in two languages, which is exactly the drift
  // those two are otherwise built to avoid. Their contract is narrower on purpose
  // (prepend + dedupe, caller's PATH verbatim); see the notes there.
  if (env.PATH != null) {
    env.PATH = env.PATH.split(":")
      .filter((e) => e !== "")
      .join(":");
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
 * Per-PTY identity vars (anything that depends on terminalId) don't belong
 * here. A shell-specific one rides `SpawnInit.env` from `prepareShellInit`
 * (e.g. zsh's ZDOTDIR); a shell-agnostic one (like `KAVAL_TERMINAL_ID`) is
 * stamped directly in the spawn caller's locator cluster next to
 * `KAVAL_SOCKET`, so it reaches even a shell we don't wrap.
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

/** The BAKE: what a nix wrapper tells a daemon. The tool directories from the
 *  daemon's OWN build closure, colon-joined, highest priority first.
 *
 *  Written only by a build — `default.nix`'s `default` wrapper (local) and the
 *  `padi-agent` wrapper (remote) — and read only by `readAgentToolsBake` plus
 *  kolu-server's forward of it onto the padi it supervises. It is NOT the name
 *  stamped into a spawned terminal; that is `TERMINAL_TOOLS_PATH_ENV`.
 *
 *  **Two names because they are two facts, pointing opposite ways.** They used
 *  to share one, and a daemon started INSIDE a kolu terminal then read that
 *  terminal's stamp as its own bake — handing a foreign build's `kaval-tui` /
 *  `padi-tui` to every terminal it spawned, the exact tool/daemon skew this
 *  design exists to abolish. The gate that caught it (`KOLU_PADI_BIN &&`) was a
 *  third, unrelated variable used as a discriminator. With the bake name never
 *  present in a terminal env, nothing can inherit it and the skew is
 *  unspellable rather than guarded. */
export const AGENT_TOOLS_BAKE_ENV = "KOLU_AGENT_TOOLS_PATH";

/** The STAMP: what a daemon tells a terminal. The tool directories it put on
 *  that terminal's `PATH`, colon-joined, in the same order.
 *
 *  Written only by padi's `composeSpawnInput`, read only by `PATH_REASSERT` in
 *  the wrapper rcfile — so the dirs survive a dotfile that assigns `PATH`
 *  absolutely. Nothing reads it as a bake, so a nested kolu cannot inherit a
 *  toolchain from the terminal it was launched in.
 *
 *  Being `KOLU_*` is load-bearing — `cleanEnv`'s `isKoluInternalEnvKey` strip
 *  means an ambient value can never ride the allowlist into a PTY, so every
 *  terminal's value is the one its OWN spawner stamped (the same self-ownership
 *  property `KAVAL_TERMINAL_ID` has). */
export const TERMINAL_TOOLS_PATH_ENV = "KOLU_TERMINAL_TOOLS_PATH";

/**
 * The tool dirs a wrapper baked onto THIS process — the client CLIs every
 * terminal this daemon spawns must be able to run (`kaval-tui`, `padi-tui`, and
 * the `kolu` whose `mcp` face an agent's `.mcp.json` invokes). `[]` when unbaked.
 *
 * **Why this is a fact a daemon is TOLD, never one it derives.** The dirs must
 * be the ones from the SAME build as the running daemon — an agent inside a
 * terminal that drives its siblings speaks padi's wire, so a tool from a
 * different build is exactly the contract skew the daemon's staleKey machinery
 * exists to prevent. Only the build system knows that path, so it bakes it:
 *
 *   - **remote** — the provisioned agent closure's own wrapper sets it to its
 *     `$out/bin` (a self-reference, resolved at build time), so a padi reached
 *     over ssh reports the closure that was actually copied to that host. There
 *     is no env channel across `ssh`, and nothing to thread through argv: the
 *     binary that boots already carries the answer.
 *   - **local** — the `default` wrapper sets it and `kolu-server` forwards it
 *     onto padi's spawn env, so a locally-supervised padi is stamped the same way.
 *
 * Absent (a from-source `just dev` / e2e padi, which has no wrapper to bake it)
 * the value is simply empty and terminals carry no injected tools — explicit
 * absence, not a guessed default. Deriving a path here instead — from
 * `process.execPath`, `argv[1]`, or a search of `PATH` — would be precisely the
 * silent-degradation fallback the repo forbids: it would resolve to the tsx
 * loader or to whatever build happens to be installed on the host, which is the
 * skew this indirection exists to make unspellable.
 *
 * `env` is injectable so the resolution is testable without touching the
 * process env.
 */
export function readAgentToolsBake(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const raw = env[AGENT_TOOLS_BAKE_ENV];
  if (raw == null || raw === "") return [];
  return raw.split(":").filter((dir) => dir !== "");
}

/** The prepend/dedupe rule as DATA — the single oracle BOTH implementations are
 *  tested against, so the TypeScript half (`prependPathEntries`) and the shell
 *  half (`PATH_REASSERT`) cannot drift. Co-location in one file is not
 *  unification: the rule is written twice, in two languages, and only a shared
 *  table makes a change to either red until the other follows. Add a row and
 *  both halves are asserted against it.
 *
 *  Every row is behaviour both halves genuinely share, because that is the only
 *  thing a shared oracle can be. The rule is deliberately minimal — prepend,
 *  skip what is already there, leave the caller's `PATH` otherwise verbatim
 *  (the `"/usr/bin::/bin"` row pins that: an empty entry the caller had is still
 *  there afterwards). Sanitizing a caller's `PATH` is a DIFFERENT job and lives
 *  in exactly one place, `cleanEnv` — see the empty-entry note there. */
export const PATH_PREPEND_CASES: ReadonlyArray<{
  path: string;
  dirs: readonly string[];
  expect: string;
}> = [
  { path: "/usr/bin:/bin", dirs: ["/a", "/b"], expect: "/a:/b:/usr/bin:/bin" },
  { path: "/usr/bin:/a", dirs: ["/a"], expect: "/usr/bin:/a" },
  { path: "", dirs: ["/a"], expect: "/a" },
  { path: "/usr/bin:/bin", dirs: [], expect: "/usr/bin:/bin" },
  // The caller's PATH is passed through unedited, empty entry and all.
  { path: "/usr/bin::/bin", dirs: ["/a"], expect: "/a:/usr/bin::/bin" },
];

/** Prepend `dirs` to a `PATH` value, preserving `dirs` order and dropping any
 *  entry already present (so a re-spawn or a nested terminal can't grow PATH
 *  without bound). Pure string algebra — the TS half of the two-context
 *  guarantee whose shell half is `PATH_REASSERT`. Both are driven from
 *  `PATH_PREPEND_CASES` so the "prepend without duplicating" rule has one
 *  oracle, not one address.
 *
 *  The contract is exactly that and nothing more: the caller's existing `PATH`
 *  comes out verbatim, including any empty entry it carried. This function does
 *  NOT sanitize somebody else's `PATH` — that hardening happens once, at the
 *  `cleanEnv` boundary, so it isn't re-implemented here and again in POSIX shell
 *  in `PATH_REASSERT`. What IS filtered here is the `dirs` we were asked to add:
 *  an empty string among them would mean "put the current directory on PATH",
 *  which this function must never introduce on its own. */
export function prependPathEntries(
  currentPath: string | undefined,
  dirs: readonly string[],
): string {
  const current = currentPath ?? "";
  // A wholly empty (or absent) PATH is ZERO entries, not one empty entry — the
  // same reading the shell half takes with `${PATH:+:$PATH}`, which appends
  // nothing at all when `$PATH` is empty.
  const existing = current === "" ? [] : current.split(":");
  const fresh = dirs.filter((d) => d !== "" && !existing.includes(d));
  return [...fresh, ...existing].join(":");
}

/** The shell half of the guarantee: re-assert the tool dirs on `PATH` AFTER the
 *  user's dotfiles have been replayed.
 *
 *  Spawn-env alone is not enough. The replay above re-sources `~/.bashrc` /
 *  `~/.zshrc`, and a dotfile that does an ABSOLUTE `export PATH=…` (common, and
 *  the whole reason the replay exists — see this module's header) silently drops
 *  whatever the spawn env put there. So the dirs are asserted twice: once in the
 *  spawn env (so a shell we don't wrap, and any non-shell argv, still gets them)
 *  and once here (so a wrapped shell keeps them no matter what the user's
 *  dotfiles do to PATH).
 *
 *  The dirs are read from `$KOLU_TERMINAL_TOOLS_PATH` at runtime rather than
 *  interpolated into this source: the block is then a FIXED string with no
 *  caller data in it, so no shell-quoting question arises at all (a path with a
 *  space or a metacharacter is data in a variable, never source to re-parse).
 *  POSIX-only syntax — one text for both the bash and zsh wrappers.
 *
 *  Same minimal contract as the TS half: prepend, skip a dir already on `$PATH`,
 *  and otherwise leave `$PATH` byte-identical — it does not rewrite the inherited
 *  value, so an empty entry a dotfile left there survives. That is deliberate:
 *  empty-entry hardening happens once at the `cleanEnv` boundary rather than
 *  being re-implemented here in POSIX shell, which is what would let the two
 *  halves drift. The `[ -z "$__kolu_dir" ] && continue` above filters the dirs
 *  we were ASKED to add, so this block never introduces one itself.
 *
 *  Exported so `PATH_PREPEND_CASES` can be asserted against THIS text under a
 *  real bash and zsh, not against a paraphrase of it. */
export const PATH_REASSERT = [
  `__kolu_path_reassert() {`,
  `  __kolu_new=""; __kolu_rest="\${1-}"`,
  `  while [ -n "$__kolu_rest" ]; do`,
  `    __kolu_dir="\${__kolu_rest%%:*}"`,
  `    case "$__kolu_rest" in *:*) __kolu_rest="\${__kolu_rest#*:}" ;; *) __kolu_rest="" ;; esac`,
  `    [ -z "$__kolu_dir" ] && continue`,
  `    case ":$PATH:" in *":$__kolu_dir:"*) continue ;; esac`,
  `    __kolu_new="\${__kolu_new:+$__kolu_new:}$__kolu_dir"`,
  `  done`,
  `  [ -n "$__kolu_new" ] && PATH="$__kolu_new\${PATH:+:$PATH}"`,
  `  export PATH`,
  `  unset __kolu_new __kolu_rest __kolu_dir`,
  `}`,
  `__kolu_path_reassert "\${${TERMINAL_TOOLS_PATH_ENV}-}"`,
  `unset -f __kolu_path_reassert`,
].join("\n");

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
 * The wrapper layers three things in order: replay (user dotfiles the shell
 * would have auto-sourced) → PATH re-assert (`PATH_REASSERT`) → hooks (kolu's
 * OSC injection). The layering is load-bearing — replay must precede hooks so
 * user PROMPT_COMMAND / starship etc. can't clobber our hooks, and it must
 * precede the PATH re-assert for the same reason in the other direction: a
 * dotfile's absolute `export PATH=…` runs during replay, so the re-assert only
 * holds if it comes AFTER. PROMPT_COMMAND in env doesn't work because the
 * user's rc would overwrite it.
 *
 * The PATH re-assert needs no argument: it reads `TERMINAL_TOOLS_PATH_ENV`
 * (`$KOLU_TERMINAL_TOOLS_PATH`) — the STAMP that padi's `composeSpawnInput`
 * already put in this terminal's env — and no-ops when that is unset. So it is
 * emitted unconditionally rather than gated on an option — one less knob, and
 * the rcfile stays a pure function of the shell, not of spawn policy.
 *
 * It must NOT read the BAKE name (`AGENT_TOOLS_BAKE_ENV` /
 * `$KOLU_AGENT_TOOLS_PATH`): that name is written only by nix wrappers, so a
 * daemon started INSIDE a kolu terminal would read that terminal's stamp as its
 * own bake and hand a foreign build's tools to every terminal it then spawns —
 * the tool/daemon skew the two-name split exists to abolish.
 *
 * Only bash and zsh get this: `selectShellInit` returns a plan for those two and
 * `null` for everything else, so fish and friends keep the spawn-env prepend
 * alone (best effort — an absolute `set -x PATH` in `config.fish` still drops
 * the tools). The docs state that bound explicitly rather than promising it
 * everywhere.
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
  const rcContent = [...init.replay(home), PATH_REASSERT, ...init.hooks].join(
    "\n",
  );
  return init.plan(rcContent, terminalId, rcDir);
}
