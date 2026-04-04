# agents

Kolu-specific agent configuration, managed by [APM](https://microsoft.github.io/apm/). Shared workflow and skills come from [srid/agency](https://github.com/srid/agency).

`just ai::apm` deploys primitives to `.claude/` (rules, commands, skills, hooks). The generated output is gitignored — `just ai::agent` runs `apm install` and launches the coding agent. Set `AI_AGENT` to override the default (`claude --dangerously-skip-permissions`).
