# agents

Kolu-specific agent configuration, managed by [APM](https://microsoft.github.io/apm/). Shared workflow and skills come from [srid/agency](https://github.com/srid/agency).

## Recipes (`just ai::*`)

| Recipe                | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `just ai`             | Install APM config + launch coding agent (default)       |
| `just ai::apm`        | Deploy APM primitives to agent runtime directories       |
| `just ai::apm-update` | Advance locked deps to latest refs (all, or `<package>`) |

Set `AI_AGENT` to override the default agent (`claude --dangerously-skip-permissions`).

## Why `.claude/` is vendored

The generated `.claude/` output is committed to git rather than gitignored. This is intentional:

- **Zero-setup for agents** — Claude Code works immediately after checkout, no `apm install` step needed. New worktrees get rules, skills, and hooks for free.
- **GitHub-browsable** — anyone can read `.claude/rules/` on GitHub to understand the agent config without cloning.

The single source of truth remains `apm.yml` + top-level `.apm/`. Edit sources there, run `just ai::apm`, and commit the result.
