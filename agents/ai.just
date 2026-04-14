# Run recipes from project root, not agents/
set working-directory := '..'

# Pinned to juspay's fork while the hook-idempotency fix (microsoft/apm#708)
# is unreleased upstream. Revert to `microsoft/apm` once the fix lands.
apm_cmd := 'uvx --from git+https://github.com/juspay/apm@fix/hook-idempotent-install apm'

# Deploy APM primitives to .claude/ and .opencode/
#
# APM's `-t` flag takes a single value, and `-t all` deploys to
# .cursor/ + .codex/ + .github/ too. Running install twice with
# explicit targets is the cleanest way to deploy claude+opencode
# only. Collapse to a single invocation once upstream adds a
# multi-target flag: https://github.com/microsoft/apm/issues/529
apm:
    {{ apm_cmd }} install -t claude
    {{ apm_cmd }} install -t opencode

# Advance locked APM dependencies to latest refs (all, or specific packages)
apm-update *packages:
    {{ apm_cmd }} deps update {{ packages }}

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    {{ apm_cmd }} audit --ci

# Verify vendored .claude/ + .opencode/ match .apm/ sources + security audit
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
    # Two passes with explicit -t, matching the `apm` recipe. The target
    # folders must pre-exist: without them, `-t <target>` silently
    # no-ops on local-package integration (the `./agents` entry in
    # apm.yml). Pre-creating the dirs makes local integration fire
    # and mirrors how the live worktree looks.
    mkdir "$scratch/.claude" "$scratch/.opencode"
    (cd "$scratch" && {{ apm_cmd }} install -t claude >/dev/null)
    (cd "$scratch" && {{ apm_cmd }} install -t opencode >/dev/null)
    # Exclude files that apm doesn't manage: launch.json is user-owned;
    # `.claude/*` entries in .gitignore are runtime state written by
    # Claude Code itself (worktree bookkeeping, local settings, session
    # lockfiles); and `.opencode/` accumulates plugin-install artifacts
    # (package.json, node_modules, etc.) gitignored by the .opencode/
    # .gitignore that apm emits. Keep this list in sync with the
    # project-level .gitignore and .opencode/.gitignore — if a new
    # runtime file appears in either, add it here too.
    diff_args=(
        -x launch.json
        -x worktrees
        -x settings.local.json
        -x scheduled_tasks.lock
        -x .gitignore
        -x node_modules
        -x package.json
        -x package-lock.json
        -x bun.lock
    )
    if ! diff -r "${diff_args[@]}" .claude "$scratch/.claude"; then
        echo "ERROR: .claude/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi
    if ! diff -r "${diff_args[@]}" .opencode "$scratch/.opencode"; then
        echo "ERROR: .opencode/ out of sync with sources — run: just ai::apm" >&2
        exit 1
    fi

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}
