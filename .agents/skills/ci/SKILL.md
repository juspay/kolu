---
name: ci
description: Reference for the `ci` runner — how to invoke a full pipeline, a single recipe, or a platform-pinned node from a project that depends on `juspay/ci`. Trigger when the user asks to "run ci", "run the pipeline", "re-run a check", or names a specific recipe by `<recipe>@<platform>`.
---

# ci

`ci` translates a project's `just` recipe DAG into a `process-compose` pipeline and runs it. Multi-platform lanes fan out via SSH; commit statuses get posted (in strict mode) under `<recipe>@<platform>` contexts. Full background in the [repo README](https://github.com/juspay/ci/blob/main/README.md); the subcommand surface below is what you'll reach for most often.

## Modes

| Variable | Effect |
| --- | --- |
| `CI` unset (default) | **Local mode.** Runs against the live working tree. No GitHub status posts, no clean-tree refuse. Use for iterating. |
| `CI=true` | **Strict mode.** Refuses a dirty tree, snapshots `HEAD` via `git worktree`, posts commit statuses, splits per-recipe logs into `.ci/<sha>/<plat>/<recipe>.log`. Use for "real" CI runs. |

Both modes share the same verdict-summary at the end (`── ci run summary ──`) and exit non-zero if any node failed.

## Common invocations

```sh
# Full pipeline (canonical [metadata("ci")] root, every platform in the fanout)
ci run                # local mode
CI=true ci run        # strict mode

# Re-run a single failed recipe on a specific lane — overwrites the same
# GitHub commit-status context the full run wrote (closes the red check).
ci run e2e@x86_64-linux

# Re-run a single recipe across every pipeline platform.
ci run e2e

# Multiple positional selectors compose — `e2e` AND `lint` both run.
ci run e2e lint

# Skip the dependency closure; run ONLY the named nodes. Setup nodes
# auto-ride for remote-platform recipes regardless.
ci run --no-deps e2e@aarch64-darwin

# Use a different DAG root instead of the [metadata("ci")] recipe.
ci run --root release-pipeline

# One-shot redirect of a platform to a throwaway host (LXC container,
# alternate SSH alias). Repeatable per platform.
ci run --host x86_64-linux=root@lxc-foo

# Drive process-compose's interactive TUI instead of headless logs.
ci run --tui

# Forward arbitrary args to `process-compose up` after --.
ci run -- -t=false
```

## Inspection subcommands (no side effects)

```sh
# Print the assembled process-compose YAML — no host prompts, no git
# rev-parse, works offline.
ci dump-yaml

# Print the dependency graph in Mermaid flowchart syntax.
ci graph

# PATCH GitHub branch-protection's required_status_checks to the
# (recipe, platform) contexts the canonical DAG produces. --dry-run
# prints what would be PATCHed without touching the API.
ci protect --dry-run
ci protect                  # writes to default branch
ci protect --branch develop
```

## Decision flow

1. **Full canonical run?** → `ci run` (or `CI=true ci run` for strict mode).
2. **Flaky check on a PR, only one lane is red?** → `ci run <recipe>@<platform>` — same status context, overwrites the failure.
3. **Iterating on one recipe locally?** → `ci run <recipe>` (no platform pin = fans out to every pipeline platform; `<recipe>@<localPlat>` if you only want the local lane).
4. **Investigating "what would this run?"** → `ci dump-yaml` or `ci graph`.
5. **Setting up a new repo?** → run `ci protect --dry-run` after at least one full run, verify the contexts look right, then `ci protect` to lock them in.

## Hosts config

`ci` reads `~/.config/ci/hosts.json`:

```json
{
  "x86_64-linux":   "srid1",
  "aarch64-darwin": "sincereintent"
}
```

Keys are full Nix system tuples (`x86_64-linux`, `aarch64-linux`, `aarch64-darwin`). Values are anything `ssh` knows how to dial — bare hostname, `user@host`, alias from `~/.ssh/config`. Missing platforms silently drop from the fanout (the user opts in by adding the entry). Override per-run with `--host PLATFORM=ADDR`.

## When NOT to use this skill

- The user is asking *about* ci's internals (how the YAML is shaped, what `_ci-setup` does, why `[metadata("ci")]` matters) — that's a docs question, point them at the [repo README](https://github.com/juspay/ci/blob/main/README.md).
- The user wants the runner to do something it doesn't support (parallel cross-platform within one recipe, mid-run config reload, MCP introspection) — those are not supported today; check the README's Roadmap section.
