# Deploy APM primitives to .claude/ (rules, commands, skills, hooks)
apm:
    rm -rf .claude/commands .claude/rules .claude/skills .claude/hooks .claude/settings.json
    uvx --from git+https://github.com/microsoft/apm apm install

# Audit APM packages for security issues (Unicode, lockfile consistency)
apm-audit:
    uvx --from git+https://github.com/microsoft/apm apm audit --ci

# Install APM config and launch coding agent (AI_AGENT overrides default)
agent *args:
    just ai::apm
    {{ env('AI_AGENT', 'claude --dangerously-skip-permissions') }} {{ args }}
