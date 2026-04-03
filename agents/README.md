# agents

Kolu-specific agent configuration, managed by [APM](https://microsoft.github.io/apm/). Shared workflow and skills come from [srid/agency](https://github.com/srid/agency).

`just apm` deploys primitives from `.apm/` to `.claude/` (rules, commands, skills, hooks). Vendored output is committed; CI runs `just apm-sync` to verify it stays in sync.
