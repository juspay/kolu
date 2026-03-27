/**
 * Shell environment preparation for PTY spawning.
 *
 * Strips nix/direnv pollution from the server's env before spawning
 * the user's PTY shell, and injects OSC 7 CWD reporting hooks.
 */

import { userInfo, tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/**
 * Env var patterns injected by nix devshells / direnv that must NOT
 * leak into the user's PTY shell (wrong PS1, shopt errors, direnv
 * unloading, multi-line derivation junk).
 */
const STRIP_PATTERNS: RegExp[] = [
  /^NIX_/, // nix toolchain / store vars
  /^DIRENV_/, // direnv session state
  /^__/, // internal markers (__ETC_PROFILE_DONE, etc.)
  /^KOLU_/, // re-injected per-terminal (clipboard, fonts, …)
  /^IN_NIX_SHELL$/, // nix shell indicator
  /^BASH_ENV$/, // unexpected script sourcing
  /^CONFIG_SHELL$/, // nix store bash path
  /^HOST_PATH$/, // nix-specific PATH variant
];

/** Exact nix derivation vars from mkShell / stdenv. */
const STRIP_EXACT = new Set([
  // build toolchain
  "AR",
  "AS",
  "CC",
  "CXX",
  "LD",
  "NM",
  "OBJCOPY",
  "OBJDUMP",
  "RANLIB",
  "READELF",
  "SIZE",
  "STRINGS",
  "STRIP",
  // derivation plumbing
  "builder",
  "buildInputs",
  "buildPhase",
  "cmakeFlags",
  "configureFlags",
  "configurePhase",
  "depsBuildBuild",
  "depsBuildBuildPropagated",
  "depsBuildTarget",
  "depsBuildTargetPropagated",
  "depsHostHost",
  "depsHostHostPropagated",
  "depsTargetTarget",
  "depsTargetTargetPropagated",
  "DETERMINISTIC_BUILD",
  "doCheck",
  "doInstallCheck",
  "dontAddDisableDepTrack",
  "installPhase",
  "mesonFlags",
  "name",
  "nativeBuildInputs",
  "out",
  "outputs",
  "patches",
  "phases",
  "preferLocalBuild",
  "propagatedBuildInputs",
  "propagatedNativeBuildInputs",
  "shell",
  "shellHook",
  "SOURCE_DATE_EPOCH",
  "src",
  "stdenv",
  "strictDeps",
  "system",
  "NIXPKGS_CONFIG",
  "NoDefaultCurrentDirectoryInExePath",
]);

function isNixVar(key: string): boolean {
  return STRIP_EXACT.has(key) || STRIP_PATTERNS.some((re) => re.test(key));
}

/**
 * Build a clean env for the PTY shell.
 *
 * The server may run inside nix/direnv which pollutes the env with
 * NIX_*, DIRENV_*, BASH_ENV, derivation vars, etc. — these break the
 * user's shell. Instead of allowlisting a handful of essentials (which
 * drops legitimate user vars like $ZSH for oh-my-zsh), we blocklist
 * the known nix/direnv pollution and forward everything else.
 */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !isNixVar(k)) {
      env[k] = v;
    }
  }
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
