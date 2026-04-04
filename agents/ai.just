# Run recipes from project root, not agents/
set working-directory := '..'

apm_cmd := 'uvx --from git+https://github.com/microsoft/apm apm'

# Deploy APM primitives to .claude/ (rules, commands, skills, hooks)
apm:
    {{ apm_cmd }} install

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    {{ apm_cmd }} audit --ci

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    just ai::apm
    just ai::apm-audit
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
