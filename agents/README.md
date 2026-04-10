# agents

Kolu-specific agent configuration, managed by [APM](https://microsoft.github.io/apm/). Shared workflow and skills come from [srid/agency](https://github.com/srid/agency).

## Recipes (`just ai::*`)

| Recipe                | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `just ai`             | Install APM config + launch coding agent (default)       |
| `just ai::apm`        | Deploy APM primitives to `.claude/`                      |
| `just ai::apm-update` | Advance locked deps to latest refs (all, or `<package>`) |
| `just ai::apm-audit`  | Security audit (Unicode, lockfile consistency)           |
| `just ai::apm-sync`   | Verify vendored `.claude/` matches sources (used by CI)  |

Set `AI_AGENT` to override the default agent (`claude --dangerously-skip-permissions`).

## Why `.claude/` is vendored

The generated `.claude/` output is committed to git rather than gitignored. This is intentional:

- **Branch protection enforces `apm-sync`** — no PR can merge with `.claude/` out of sync with `.apm/` sources. This is a platform-level guardrail that can't be bypassed by editing a justfile or gitignore.
- **Zero-setup for agents** — Claude Code works immediately after checkout, no `apm install` step needed. New worktrees get rules, skills, and hooks for free.
- **GitHub-browsable** — anyone can read `.claude/rules/` on GitHub to understand the agent config without cloning.

The single source of truth remains `apm.yml` + `agents/.apm/`. Edit sources there, run `just ai::apm`, and commit the result.
