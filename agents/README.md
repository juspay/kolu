# agents

This directory is two things:

1. **A self-contained, reusable APM package** (`apm.yml` + `.apm/`) of
   repo-agnostic AI-native development skills extracted from kolu — usable in
   **any** project, not just this one. See
   [APM](https://microsoft.github.io/apm/).
2. **Kolu's APM recipes** (`ai.just`) that install + compile the agent runtime
   for this repo.

Kolu's own root `apm.yml` consumes the package via a **local path dependency**
(`- path: ./agents`); other shared skills still come from
[srid/agency](https://github.com/srid/agency) and the juspay packages.

## The reusable package (`agents/apm.yml` + `agents/.apm/skills/`)

Repo-agnostic skills that don't depend on kolu internals:

| Skill                | What it does                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `be` / `be-review`   | Take a task end-to-end with a serial AI review gauntlet                 |
| `lens-debate`        | Structural-review debate between the lowy and hickey lenses             |
| `codex-debate`       | codex ⇄ Claude debate to consensus (review or freeform answer)          |
| `perfection-review`  | Adversarial "ideal-bar" review, fanned out via Workflow                 |
| `architecture-first-principles` | The state-and-time lens — 5 grounded CS principles (values, pure core, one-authority/clock, illegal-states-unrepresentable, end-to-end) |
| `kolu`               | Drive one agent from another through kolu terminals (`kaval-tui`)       |
| `surface`            | Consume the shared `@kolu/surface` stack in a downstream app            |

The package declares the shared packages these skills call
(`srid/agency`, `juspay/project-unknown`, `juspay/odu`) as its own
dependencies, so they come along transitively.

**Project-supplied skills.** The gauntlet references a few skills that are
intentionally **not** vendored here because they're inherently
project-specific — a consuming project supplies its own:

- `/atlas` — the project's design-note / plan-of-record system
- `/test` — the project's e2e harness entry point
- `/dev-server` — how the project boots locally
- `/evidence` — *optional*; how the project captures visual PR evidence
  (kolu's own lives at `.apm/skills/evidence/`)

## Using this in your own project

The package lives in-tree at `juspay/kolu/agents`. To pull it into another APM
project, add it (subpath form `owner/repo/subpath`) to your `apm.yml`:

```yaml
dependencies:
  apm:
    - juspay/kolu/agents          # the reusable skills package (deps come transitively)
```

Then install with APM (e.g. `apm install`, or your project's equivalent recipe).
After install you'll have `be`, `be-review`, `lens-debate`, `codex-debate`,
`perfection-review`, `kolu`, and `surface` available to your runtime.

To make the gauntlet fully functional, **provide your own** `/atlas`, `/test`,
and `/dev-server` skills. The `/be` flow also calls `/evidence` for visual PR
evidence — supply your own if you want that step (it's optional; `/be` notes
when no visual artifact applies).

## Recipes (`just ai::*`)

| Recipe                | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `just ai`             | Install APM config + launch coding agent (default)       |
| `just ai::apm`        | Deploy APM primitives to agent runtime directories       |
| `just ai::apm-update` | Advance locked deps to latest refs (all, or `<package>`) |

Set `AI_AGENT` to override the default agent (`claude --dangerously-skip-permissions`).

## Why `.claude/` is vendored

The generated `.claude/` output is committed to git rather than gitignored. This is intentional:

- **Zero-setup for agents** — Claude Code works immediately after checkout, no `apm install` step needed. New worktrees get rules, skills, and hooks for free.
- **GitHub-browsable** — anyone can read `.claude/rules/` on GitHub to understand the agent config without cloning.

The single source of truth remains `apm.yml` + top-level `.apm/` (kolu-local
skills) plus `agents/apm.yml` + `agents/.apm/` (the reusable package). Edit
sources there, run `just ai::apm`, and commit the result.
