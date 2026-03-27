/**
 * Shell environment preparation for PTY spawning.
 *
 * Strips nix/direnv pollution from the server's env before spawning
 * the user's PTY shell, and injects OSC 7 CWD reporting hooks.
 */

import { userInfo, tmpdir } from "node:os";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/** Prefix patterns injected by nix devshells / direnv. */
const STRIP_PREFIX = /^(NIX_|DIRENV_|__|KOLU_)/;

/** Exact var names to strip — nix/direnv session state + derivation plumbing. */
const STRIP_EXACT = new Set([
  // nix / direnv session
  "BASH_ENV",
  "CONFIG_SHELL",
  "HOST_PATH",
  "IN_NIX_SHELL",
  "NIXPKGS_CONFIG",
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
  "NoDefaultCurrentDirectoryInExePath",
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
]);

/**
 * Build a clean env for the PTY shell by stripping nix/direnv pollution
 * while forwarding everything else (user vars like $ZSH, $NVM_DIR, etc.).
 */
export function cleanEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) =>
        v !== undefined && !STRIP_EXACT.has(k) && !STRIP_PREFIX.test(k),
    ),
  ) as Record<string, string>;
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
