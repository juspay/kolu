# agents

Kolu-specific agent configuration, managed by [APM](https://microsoft.github.io/apm/). Shared workflow and skills come from [srid/agency](https://github.com/srid/agency).

`just ai::apm` deploys primitives to `.claude/` (rules, commands, skills, hooks). The generated output is gitignored — `just ai::claude` runs `apm install` and launches Claude Code in one step.
