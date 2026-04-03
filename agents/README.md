# PERL

AI agent configuration package for Kolu, managed by [APM](https://github.com/microsoft/apm). See [srid.ca/ai](https://srid.ca/ai) for context.

`just apm` deploys primitives from `.apm/` to `.claude/` (rules, commands, skills, hooks). Vendored output is committed; CI runs `just apm-sync` to verify it stays in sync.
