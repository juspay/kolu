# Run recipes from project root, not agents/
set working-directory := '..'

# Enter nix develop only when not already inside it — mirrors the root
# justfile's pattern. `uvx` lives in the devshell (see shell.nix), so
# these recipes need to enter it when invoked from a bare shell (e.g.
# `just ci` → `just ai::apm-sync`).
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# Pinned to juspay's fork on the feat/install-compile-root-flag branch
# while microsoft/apm#888 (apm install --root) is unreleased upstream.
# Revert to plain `microsoft/apm` once the flag lands there.
apm_cmd := nix_shell + ' uvx --from git+https://github.com/juspay/apm@feat/install-compile-root-flag apm'

# Install native APM integrations for Claude, Codex, and OpenCode.
#
# `apm install` handles the runtime-specific folders (`.claude/`,
# `.codex/`, `.agents/skills/`, `.opencode/`). It does not generate the
# root `AGENTS.md` instruction file that Codex/OpenCode consume.
apm-install:
    {{ apm_cmd }} install

# Compile the shared instruction file for runtimes that read `AGENTS.md`.
#
# Claude already reads `.claude/` natively, so we intentionally do not
# compile `CLAUDE.md`.
apm-compile:
    {{ apm_cmd }} compile --target codex,opencode

# Refresh all APM-managed artifacts needed by Claude, Codex, and OpenCode.
apm: apm-install apm-compile

# Advance locked APM dependencies to latest refs (all, or specific packages)
apm-update *packages:
    {{ apm_cmd }} deps update {{ packages }}
    {{ just_executable() }} apm

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    {{ apm_cmd }} audit --ci

# Verify APM-managed outputs match sources + security audit
#
# `apm audit --ci` (via apm-audit above) hash-verifies every
# APM-managed file -- closes microsoft/apm#684/#887.  That covers
# .claude/, .codex/, .agents/, .opencode/, and opencode.json content
# drift without needing a scratch install + recursive diff.
#
# AGENTS.md is a compile output, NOT a lockfile-tracked deployed file,
# so we still verify it by staging install + compile into a scratch
# deploy root via `apm install --root` + `apm compile --root`
# (microsoft/apm#888) and diffing the AGENTS.md outputs.  Sources
# (apm.yml, .apm/, the project tree) stay in $PWD throughout -- the
# `--root` flags handle write redirection internally.
apm-sync: apm-audit
    #!/usr/bin/env bash
    set -euo pipefail
    scratch=$(mktemp -d)
    trap 'rm -rf "$scratch"' EXIT
    # Seed the lockfile so install resolves to the SAME commits as the
    # live tree.  apm install rewrites apm.lock.yaml during the run, so
    # this must be a copy rather than a symlink.
    [[ ! -e apm.lock.yaml ]] || cp apm.lock.yaml "$scratch/apm.lock.yaml"
    # apm install --root: writes apm_modules/, apm.lock.yaml, .claude/,
    # .codex/, .agents/, .opencode/ under $scratch while reading apm.yml
    # + .apm/ + local-path packages from $PWD.
    {{ apm_cmd }} install --root "$scratch" >/dev/null
    # apm compile --root: writes AGENTS.md / CLAUDE.md outputs under
    # $scratch while reading apm.yml + .apm/ + the project tree (for
    # placement scoring) from $PWD.  No rsync, no cd, no symlinks.
    {{ apm_cmd }} compile --root "$scratch" --target codex,opencode >/dev/null
    # Diff every AGENTS.md under the scratch tree against its counterpart
    # in the live tree.  Distributed compile produces files at multiple
    # depths (AGENTS.md, packages/AGENTS.md, etc.), so a single
    # root-level diff is not enough.  apm audit --ci above already
    # covers content-integrity for everything `apm install` writes.
    while IFS= read -r f; do
        rel="${f#$scratch/}"
        if ! diff "$rel" "$f" >/dev/null 2>&1; then
            echo "ERROR: $rel out of sync with sources -- run: just ai::apm" >&2
            diff "$rel" "$f" || true
            exit 1
        fi
    done < <(find "$scratch" -name AGENTS.md -type f)

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}

# Launch chrome-devtools-mcp server over stdio.
#
# Today the checked-in project-local MCP entrypoints are:
# - Claude Code: `.mcp.json`
# - Codex CLI: `.codex/config.toml` (only for trusted projects)
#
# The top-level `apm.yml` mirrors the same server for runtimes APM can
# configure natively today. Codex project-scoped MCP is tracked upstream
# in microsoft/apm#803; once that lands, `.codex/config.toml` should
# become APM-managed like the other generated runtime config.
#
# All paths shell out via `nix develop .#e2e --command just
# ai::mcp-chrome-devtools` so agent runtimes that start outside the nix
# devshell still get Playwright's Chrome-for-Testing.
# Chrome binary resolved from Playwright's nix-provided Chrome-for-Testing
# across platforms: `chrome-linux64/chrome` on Linux and
# `chrome-mac-*/Google Chrome for Testing.app/.../Google Chrome for Testing`
# on macOS. `find` picks either layout; a miss fails loud downstream
# (empty --executable-path → MCP server errors out visibly).
mcp-chrome-devtools:
    bash -c 'shopt -s nullglob; \
      for c in "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux64/chrome \
               "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-mac-*/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing"; do \
        [[ -x "$c" ]] && chrome="$c" && break; \
      done; \
      exec npx -y chrome-devtools-mcp@latest --headless=true --isolated=true --executable-path="$chrome"'
