# Run recipes from project root, not agents/
set working-directory := '..'

apm_cmd := 'uvx --from git+https://github.com/microsoft/apm apm'

# Deploy APM primitives to .claude/ (rules, commands, skills, hooks)
apm:
    # APM install is additive — it writes declared files but never prunes
    # files whose upstream sources disappeared, so orphans accumulate
    # silently (and `apm-sync` can't see them via git status). Wipe the
    # APM-owned tree before reinstalling; keep-list preserves user-owned
    # launch.json. https://github.com/microsoft/apm/issues/561
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
apm-sync: apm apm-audit
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -n "$(git status --porcelain .claude/)" ]; then
        echo "ERROR: .claude/ out of sync with .apm/ — run: just ai::apm"
        git status .claude/
        exit 1
    fi

# Install APM config and launch coding agent (AI_AGENT overrides default)
[default]
agent *args: apm
    just prepare
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}
