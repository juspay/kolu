---
description: Redirects agents to edit PERL/.apm/ sources instead of generated .claude/ files
applyTo: ".claude/**"
---

## Generated Files — Do Not Edit Directly

Everything under `.claude/` (except `launch.json`) is **generated** from `PERL/.apm/` by APM. Direct edits will be overwritten on the next `just apm` run.

**To modify agent configuration, edit the source files in `PERL/.apm/`:**

| `.claude/` output | Source in `PERL/.apm/`             |
| ----------------- | ---------------------------------- |
| `rules/*.md`      | `instructions/*.instructions.md`   |
| `commands/*.md`   | `prompts/*.prompt.md`              |
| `skills/*/`       | `skills/*/`                        |
| `hooks/`          | `hooks/`                           |
| `settings.json`   | Hook definitions in `hooks/*.json` |

After editing, run `just apm` to regenerate `.claude/` from sources. CI enforces sync via `just apm-sync`.
