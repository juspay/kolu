---
paths:
  - "{.apm/**,.agents/**,.claude/**,.codex/**,.opencode/**,AGENTS.md,agents/**,apm.yml,apm.lock.yaml,opencode.json}"
---

## APM Workflow

APM is not a global CLI — it runs via `uvx` through justfile recipes in `agents/ai.just`. Never try to run `apm` directly; always use the just recipes:

- **Install/regenerate** agent runtime directories from sources: `just ai::apm`
- **Update a dependency** to its latest ref: `just ai::apm-update <package>` (e.g. `just ai::apm-update juspay/odu`)

### Skill/instruction sources

`.claude/skills/<name>/` and `.claude/rules/<name>.md` are generated from the source trees below — grep **all three** before assuming something isn't apm-managed:

- **Root `.apm/`** — this repo's own package: skills like `atlas`, `test`, `dev-server`, `evidence`, `release`; instructions like this file, under `.apm/instructions/`.
- **`agents/.apm/`** — the reusable `agents/` package (a local `path:` dependency in the root `apm.yml`): the skills `surface`, `hostility-review`, `diataxis`.

- **`agent-plugin/skills/kolu/`** — the exported kolu skill and its `TUI.md` reference, consumed by `agents/apm.yml` as a local path dependency. Edit this source, not a generated runtime copy.

### An `agents/` source edit must be committed before it propagates

`just ai::apm` vendors the `agents/` path-dependency from a **git checkout** (pinned by the `agents/` package version in `apm.lock.yaml`), *not* your working tree. So an **uncommitted** edit to `agents/.apm/skills/**` regenerates the OLD cached content and silently reverts your change. Commit the source edit first, then `just ai::apm`, then **confirm the change actually landed** in the generated `.claude/skills/<name>/` — a stale vendor snapshot can ship the old text with no error.
