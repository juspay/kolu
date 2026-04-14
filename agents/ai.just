# Run recipes from project root, not agents/
set working-directory := '..'

# Pinned to juspay's fork while the hook-idempotency fix (microsoft/apm#708)
# is unreleased upstream. Revert to `microsoft/apm` once the fix lands.
apm_cmd := 'uvx --from git+https://github.com/juspay/apm@fix/hook-idempotent-install apm'

# Deploy APM primitives to .claude/ (rules, commands, skills, hooks)
apm:
    {{ apm_cmd }} install

# Advance locked APM dependencies to latest refs (all, or specific packages)
apm-update *packages:
    {{ apm_cmd }} deps update {{ packages }}

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    {{ apm_cmd }} audit --ci

# Verify vendored .claude/ matches .apm/ sources + security audit
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
    # Local inputs: symlink what apm only reads, cp what it writes through.
    # `apm install` rewrites apm.lock.yaml's `generated_at` on every run,
    # so a symlink here would mutate the real lockfile.
    ln -s "$PWD/apm.yml" "$PWD/agents" "$scratch/"
    cp "$PWD/apm.lock.yaml" "$scratch/"
    # apm's target auto-detection picks "claude" when `.claude/` exists
    # (target_detection.py). The explicit `-t claude` flag does *not*
    # produce an equivalent result — local-package integration silently
    # no-ops — so folder-existence is the reliable signal.
    mkdir "$scratch/.claude"
    (cd "$scratch" && {{ apm_cmd }} install >/dev/null)
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

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}

# Launch chrome-devtools-mcp server over stdio — wired up via the root
# `.mcp.json`, which shells out via `nix develop --command just
# ai::mcp-chrome-devtools` (Claude Code starts outside the nix devshell).
# Chrome binary resolved from Playwright's nix-provided Chrome-for-Testing
# across platforms: `chrome-linux64/chrome` on Linux and
# `chrome-mac-*/Google Chrome for Testing.app/.../Google Chrome for Testing`
# on macOS. `find` picks either layout; a miss fails loud downstream
# (empty --executable-path → MCP server errors out visibly).
#
# TODO: fold .mcp.json's entry into `dependencies.mcp` above once
# microsoft/apm#655 (Claude Code MCP adapter) merges and lands in juspay's
# fork — `.mcp.json` then becomes a generated artifact of `just ai::apm`.
mcp-chrome-devtools:
    sh -c 'chrome="$(find "$PLAYWRIGHT_BROWSERS_PATH"/chromium-* \( -name chrome -o -name "Google Chrome for Testing" \) -type f -perm -u+x 2>/dev/null | head -1)"; exec npx -y chrome-devtools-mcp@latest --headless=true --isolated=true --executable-path="$chrome"'
