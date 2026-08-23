---
description: APM workflow — how to install, update, and verify agent packages via justfile recipes
applyTo: "{.apm/**,.agents/**,.claude/**,.codex/**,.opencode/**,AGENTS.md,agents/**,apm.yml,apm.lock.yaml,opencode.json}"
---

## APM Workflow

APM is not a global CLI — it runs via `uvx` through justfile recipes in `agents/ai.just`. Never try to run `apm` directly; always use the just recipes:

- **Install/regenerate** agent runtime directories from sources: `just ai::apm`
- **Update a dependency** to its latest ref: `just ai::apm-update <package>` (e.g. `just ai::apm-update srid/agency`)

### Skill/instruction sources live in TWO trees

`.claude/skills/<name>/` and `.claude/rules/<name>.md` are generated from one of two source trees — grep **both** before assuming something isn't apm-managed:

- **Root `.apm/`** — this repo's own package: skills like `atlas`, `test`, `dev-server`, `evidence`, `release`; instructions like this file, under `.apm/instructions/`.
- **`agents/.apm/`** — the reusable `agents/` package (a local `path:` dependency in the root `apm.yml`): the skills `be`, `be-review`, `kolu`, `lens-debate`, `agent-debate`, `perfection-review`, `surface`, `architecture-first-principles`.

So editing e.g. the **kolu** skill means editing `agents/.apm/skills/kolu/SKILL.md`, **not** root `.apm/skills/`.

### An `agents/` source edit must be committed before it propagates

`just ai::apm` vendors the `agents/` path-dependency from a **git checkout** (pinned by the `agents/` package version in `apm.lock.yaml`), *not* your working tree. So an **uncommitted** edit to `agents/.apm/skills/**` regenerates the OLD cached content and silently reverts your change. Commit the source edit first, then `just ai::apm`, then **confirm the change actually landed** in the generated `.claude/skills/<name>/` — a stale vendor snapshot can ship the old text with no error.
