# agents

This directory is two things:

1. **A self-contained, reusable APM package** (`apm.yml` + `.apm/`) of
   repo-agnostic AI-native development skills extracted from kolu — usable in
   **any** project, not just this one. See
   [APM](https://microsoft.github.io/apm/).
2. **Kolu's APM recipes** (`ai.just`) that install + compile the agent runtime
   for this repo.

Kolu's own root `apm.yml` consumes the package via a **local path dependency**
(`- path: ./agents`); other shared skills come from the juspay packages.

## The reusable package (`agents/apm.yml` + `agents/.apm/skills/`)

Repo-agnostic skills that don't depend on kolu internals:

| Skill               | What it does                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| `kolu`              | Drive one agent from another through kolu terminals (`kolu`)           |
| `surface`           | Consume the shared `@kolu/surface` stack in a downstream app           |
| `hostility-review`  | Audit a done-claim against its plan with a hostile peer agent          |
| `diataxis`          | Classify, write, and audit documentation per Diátaxis                  |

The `kolu` skill lives in `../agent-plugin/skills/kolu/`, the exported Agent
Plugins package, and is consumed through a local path dependency. Its content
and references are shared with standalone plugin consumers.

The package declares the shared packages these skills call
(`juspay/project-unknown`, `juspay/odu`) as its own dependencies, so they come
along transitively. It also registers `kolu mcp` for every supported agent
runtime because `/kolu` is MCP-first; the `kolu` binary must be available on the
host's `PATH`.

**Project-supplied skills.** A consuming project brings its own `/atlas`,
`/test`, and `/dev-server` skills — those are inherently project-specific and
are deliberately not vendored here (kolu's own live at `../.apm/skills/`).

## Using this in your own project

The package lives in-tree at `juspay/kolu/agents`. To pull it into another APM
project, add it (subpath form `owner/repo/subpath`) to your `apm.yml`:

```yaml
dependencies:
  apm:
    - juspay/kolu/agents          # the reusable skills package (deps come transitively)
```

Then install with APM (e.g. `apm install`, or your project's equivalent recipe).
After install you'll have `kolu`, `surface`, `hostility-review`, and `diataxis`
available to your runtime.

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
skills), `agents/apm.yml` + `agents/.apm/` (the reusable package), and
`agent-plugin/skills/kolu/` (the exported kolu skill). Edit these sources,
run `just ai::apm`, and commit the result.
