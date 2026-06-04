# Run recipes from project root, not agents/
set working-directory := '..'

# Enter nix develop only when not already inside it — mirrors the root
# justfile's pattern. `uvx` lives in the devshell (see shell.nix), so
# these recipes need to enter it when invoked from a bare shell.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# TEMPORARY: build apm-cli from the head of microsoft/apm#1665 — the fix that
# keeps format-transformed rule files (`.claude/rules/*`) tracked + in sync;
# without it, `apm install` silently leaves edited rules stale (updates AGENTS.md
# but not `.claude/rules/`, masking the drift). The PR forks upstream `main`, so
# it also carries the compile-hang fix (#1576, released in 0.18.0).
# `refs/pull/1665/head` tracks the PR head on the base repo. Revert to
# `--from apm-cli` once it merges and a release ships.
# PR: https://github.com/microsoft/apm/pull/1665 (closes #1662).
apm_cmd := nix_shell + ' uvx --from git+https://github.com/microsoft/apm@refs/pull/1665/head apm'
apm_targets := 'claude,codex,opencode'
apm_compile_targets := 'codex,opencode'

# Install native APM integrations for Claude, Codex, and OpenCode.
#
# `apm install` handles the runtime-specific folders (`.claude/`,
# `.codex/`, `.agents/skills/`, `.opencode/`). It does not generate the
# root `AGENTS.md` instruction file that Codex/OpenCode consume.
apm-install:
    {{ apm_cmd }} install --target {{ apm_targets }}

# Compile the shared instruction file for runtimes that read `AGENTS.md`.
#
# Claude already reads `.claude/` natively, so we intentionally do not
# compile `CLAUDE.md`.
apm-compile:
    {{ apm_cmd }} compile --target {{ apm_compile_targets }}

# Refresh all APM-managed artifacts needed by Claude, Codex, and OpenCode.
apm: apm-install apm-compile

# Advance locked APM dependencies to latest refs (all, or specific packages)
apm-update *packages:
    {{ apm_cmd }} deps update --target {{ apm_targets }} {{ packages }}
    {{ just_executable() }} ai apm

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}

