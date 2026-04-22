# Run recipes from project root, not agents/
set working-directory := '..'

# Enter nix develop only when not already inside it — mirrors the root
# justfile's pattern. `uvx` lives in the devshell (see shell.nix), so
# these recipes need to enter it when invoked from a bare shell (e.g.
# `just ci` → `just ai::apm-sync`).
nix_shell := if env('IN_NIX_SHELL', '') != '' { '' } else { 'nix develop --accept-flake-config -c' }

# Pinned to juspay's fork while the hook-idempotency fix (microsoft/apm#708)
# is unreleased upstream. Revert to `microsoft/apm` once the fix lands.
apm_cmd := nix_shell + ' uvx --from git+https://github.com/microsoft/apm apm'

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
# Must NOT mutate the live .claude/ tree — concurrent Claude Code
# sessions in the same worktree would see stop hooks / rules / skills
# disappear mid-CI and crash. See #468. Instead we stage a fresh tree
# in a scratch dir and diff. The `apm` recipe above is destructive and
# stays a dev-only action. This workaround can be removed if upstream
# adds content verification to `apm audit --ci`: microsoft/apm#684.
apm-sync: apm-audit
    #!/usr/bin/env bash
    set -euo pipefail
    scratch=$(mktemp -d)
    trap 'rm -rf "$scratch"' EXIT
    # Distributed `apm compile` placement depends on the real repo layout, so
    # mirror the worktree into scratch while excluding runtime/generated trees.
    # `apm install` rewrites apm.lock.yaml's `generated_at` on every run, which
    # is fine here because the scratch copy is disposable.
    rsync -a \
        --exclude='.git/' \
        --exclude='node_modules/' \
        --exclude='.direnv/' \
        --exclude='.logs/' \
        --exclude='.claude/' \
        --exclude='.codex/' \
        --exclude='.agents/' \
        --exclude='.opencode/' \
        --exclude='AGENTS.md' \
        --exclude='CLAUDE.md' \
        "$PWD/" "$scratch/"
    # Mirror the runtime folders that drive target detection for install.
    # Compile is explicit so we only emit `AGENTS.md` for Codex/OpenCode.
    mkdir -p "$scratch/.claude" "$scratch/.codex" "$scratch/.opencode" "$scratch/.agents"
    (cd "$scratch" && {{ apm_cmd }} install >/dev/null)
    (cd "$scratch" && {{ apm_cmd }} compile --target codex,opencode >/dev/null)
    # Exclude files that apm doesn't manage: launch.json is user-owned,
    # and `.claude/*` entries in .gitignore are runtime state written by
    # Claude Code itself (worktree bookkeeping, local settings, session
    # lockfiles). Keep this list in sync with .gitignore — if a new
    # runtime file appears in .claude/, add it to .gitignore and here.
    if ! diff -r \
        -x launch.json \
        -x worktrees \
        -x settings.local.json \
        -x scheduled_tasks.lock \
        .claude "$scratch/.claude"; then
        echo "ERROR: .claude/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi
    if ! diff -r .codex "$scratch/.codex"; then
        echo "ERROR: .codex/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi
    if ! diff -r .agents "$scratch/.agents"; then
        echo "ERROR: .agents/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi
    if ! diff -r .opencode "$scratch/.opencode"; then
        echo "ERROR: .opencode/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi
    if [[ -e opencode.json || -e "$scratch/opencode.json" ]]; then
        if [[ ! -e opencode.json || ! -e "$scratch/opencode.json" ]] || \
           ! diff <(jq -S . opencode.json) <(jq -S . "$scratch/opencode.json"); then
            echo "ERROR: opencode.json out of sync with sources — run: just ai::apm" >&2
            exit 1
        fi
    fi
    if ! diff AGENTS.md "$scratch/AGENTS.md"; then
        echo "ERROR: AGENTS.md out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}

# Launch chrome-devtools-mcp server over stdio. Today Claude Code still
# needs the root `.mcp.json` entry; the top-level `apm.yml` mirrors the
# same server for runtimes APM can configure natively.
# Both paths shell out via `nix develop .#e2e --command just
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
