---
paths:
  - ".claude/**,.opencode/**"
---

## Generated Files — Do Not Edit Directly

> **This rule only applies if an `.apm/` directory exists in the project root.** If there is no `.apm/` directory, `.claude/` and `.opencode/` files are vendored directly and can be edited in place.

Everything under `.claude/` and `.opencode/` is **generated** from `.apm/` sources by APM. Direct edits will be overwritten on the next `apm install` run.

To modify agent configuration, edit the source files in `.apm/`, then run `apm install` to regenerate.
