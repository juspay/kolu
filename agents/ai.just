# Run recipes from project root, not agents/
set working-directory := '..'

# Enter nix develop only when not already inside it — mirrors the root
# justfile's pattern. `uvx` lives in the devshell (see shell.nix), so
# these recipes need to enter it when invoked from a bare shell.
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

apm_cmd := nix_shell + ' uvx --from apm-cli apm'
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

