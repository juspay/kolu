---
description: Generated agent runtime files are derived from top-level .apm sources
applyTo: "{.agents/**,.claude/**,.codex/**,.opencode/**,AGENTS.md,opencode.json}"
---

## Generated Files — Do Not Edit Directly

Everything under `.claude/`, `.codex/`, `.agents/`, and `.opencode/` is generated from top-level `.apm/` sources by APM. Direct edits will be overwritten on the next regeneration.

To modify agent configuration, edit the source files under `.apm/`, then run `just ai::apm` to regenerate the runtime directories and `AGENTS.md`.
