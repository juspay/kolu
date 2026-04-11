# Run recipes from project root, not agents/
set working-directory := '..'

apm_cmd := 'uvx --from git+https://github.com/microsoft/apm apm'

# Deploy APM primitives to .claude/ (rules, commands, skills, hooks)
apm:
    # APM install cleans up stale files from upgraded *local* packages
    # (see install.py's _local_deployed path) but not from upgraded
    # *remote* packages — upstream `apm prune` only removes orphan
    # packages, not orphan files from still-declared packages whose
    # contents shrank. Wipe the APM-owned tree before reinstalling so
    # remote-package orphans don't linger; keep-list preserves the
    # user-owned launch.json. Destructive by design — this is an
    # explicit developer action. CI uses `apm-sync` below, which
    # verifies without mutating. See #468.
    find .claude -mindepth 1 -maxdepth 1 ! -name launch.json -exec rm -rf {} +
    {{ apm_cmd }} install

# Advance locked APM dependencies to latest refs (all, or specific packages)
apm-update *packages:
    # Same hook-dup workaround as `apm` recipe — see apm#561.
    rm -f .claude/settings.json
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
# stays a dev-only action.
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
